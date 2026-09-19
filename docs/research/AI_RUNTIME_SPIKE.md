# Supabase AI Runtime Spike Design

Status: architecture review complete; load/fault spike remains pending.  
Checked: 2026-09-19

## Finding

The proposed Supabase queue plus Edge Function architecture is suitable for an MVP only when the durable Postgres queue and job ledger are the source of truth. `EdgeRuntime.waitUntil` alone is not a durable job system. Ingredient recognition must remain I/O-bound and comfortably inside Edge Function CPU, memory, and wall-clock limits.

Hosted limits currently include 256 MB memory, 2 seconds CPU per request, 150 seconds wall clock on Free, 400 seconds on paid plans, and a 150-second request idle timeout. KitchenCam should use much tighter internal timeouts.

## Proposed non-production spike topology

```text
API transaction
  -> reserve quota
  -> create scan_job(idempotency_key, attempt=0)
  -> enqueue {job_id, scan_id, schema_version}

Database webhook for low latency + cron sweeper for recovery
  -> invoke small Edge consumer
  -> read bounded queue batch with visibility timeout
  -> atomically lease job
  -> fetch private image using service authority
  -> call provider with 25s timeout
  -> validate and normalize
  -> commit result + finalize quota + archive message
```

Use a webhook only as a wake-up hint. A cron-driven sweeper must recover missed invocations and stale leases. Do not expose queue functions to the mobile client.

## Queue and retry semantics

- Delivery is effectively at-least-once across crashes, even though PGMQ provides one consumer within a visibility window. Therefore every side effect is idempotent.
- Unique keys: `scan_id` for one active recognition job and client-supplied idempotency key for request replay.
- Acquire a job with a compare-and-set state transition and lease expiry. A second worker observing a completed job archives its message without re-calling AI.
- Start with batch size 1-3 and a 60-second visibility timeout; extend only if measured provider p95 requires it.
- Retry network errors, `429`, and provider `5xx` with jittered backoff. Do not retry invalid image, unsupported content, schema-invalid after bounded repair, cancellation, or deleted account.
- Cap provider attempts at 3 initially. Move exhausted transient jobs to an explicit dead-letter queue and mark them for operator replay.
- Store attempt number, next attempt, provider request ID, safe error code, lease times, model/schema versions, and correlation ID.
- Release reserved quota automatically on permanent KitchenCam/provider failure. Finalize quota only after a usable result is committed.

## Failure recovery

Commit recognition results and job completion in one database transaction. Raw image deletion is a separate idempotent retention job scheduled after successful processing. A watchdog requeues expired leases and flags impossible state combinations. Cancellation checks occur before provider call and before commit; late provider responses cannot overwrite a terminal state.

Provider timeout does not prove the provider did no work, so retries may cost money. Include provider request IDs where supported and count all attempts in cost metrics.

## Observability

Metrics: queue depth, oldest-visible age, enqueue-to-start, provider latency, total duration, success/error by safe code, attempts, lease expiries, DLQ depth, timeout/546/504 rates, model token/cost units, and quota reserve/finalize/release mismatches.

Structured logs contain job/correlation IDs and versions, never photos, signed URLs, ingredient lists, allergies, prompts, tokens, or provider credentials. Sentry receives scrubbed exception classes and traces. Alerts cover oldest job age, error rate, spend velocity, retry storm, DLQ growth, and deletion backlog.

## Spike matrix and pass gates

Run with synthetic/licensed images only at 1, 5, 20, and 50 concurrent submissions. Inject provider 429/500/timeout, malformed JSON, function termination, duplicate webhook, duplicate enqueue, database failure before/after provider response, expired signed URL, cancellation, and account deletion.

Pass when:

- no duplicate committed result or double quota charge occurs;
- every terminal KitchenCam/provider failure releases quota exactly once;
- all crash-interrupted jobs recover or reach DLQ without manual database edits;
- p95 queue age stays below 5 seconds at expected MVP peak and p95 total completion stays below 20 seconds under normal provider behavior;
- resource-limit errors remain below 0.5% and unexplained job loss is zero;
- raw-image deletion backlog is observable and recoverable;
- cost/spend kill switches stop new provider calls while preserving user-visible status.

## Dedicated-worker migration triggers

Move consumption to a container/server worker while retaining Postgres/queue contracts when any trigger persists after optimization:

- p95 provider/job runtime exceeds 45 seconds or requires long polling/streaming;
- CPU-heavy preprocessing approaches the 2-second CPU limit or memory approaches 256 MB;
- resource termination exceeds 1% or queue age breaches SLO at expected peak;
- sustained throughput needs explicit autoscaling, per-provider worker pools, or more controlled concurrency;
- multi-step fan-out, provider callbacks, GPU/local models, or large image transformations are required;
- operations need deployment independence, long-lived processes, or richer worker telemetry.

The mobile API and queue message must not change when the worker runtime changes.

## Sources

- Edge Function limits: https://supabase.com/docs/guides/functions/limits
- Background tasks: https://supabase.com/docs/guides/functions/background-tasks
- Edge timeout behavior: https://supabase.com/docs/guides/troubleshooting/edge-functions-worker-timeouts-and-websocket-drops
- Supabase Queues: https://supabase.com/docs/guides/queues
- Queue API/visibility: https://supabase.com/docs/guides/queues/api
- Database Webhooks: https://supabase.com/docs/guides/database/webhooks
- Scheduled Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions
- Supabase Cron: https://supabase.com/docs/guides/cron

All sources checked 2026-09-19. Revalidate hosted limits before implementing the spike.
