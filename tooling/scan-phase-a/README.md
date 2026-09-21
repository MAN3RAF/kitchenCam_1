# Local scan Phase A research

These are reviewable specifications and disposable local experiments, **not** app features, API handlers, migrations, storage policies, queue workers, or deployable infrastructure. The mobile module boundary already excludes `tooling/`.

- `contracts.ts`, `state-machine.ts`, `idempotency.ts`, `recognition-port.ts`: executable contracts; Jest coverage lives in `tests/scan-phase-a-contracts.test.ts`.
- `upload-spike.cjs`: local Supabase matrix and a genuine ten-minute expiry wait. Creates/removes only namespaced synthetic fixture objects and disposable users. No remote URL or environment-file credentials are accepted. It does not modify policies or buckets.
- `upload-supplement.cjs`: resumed concurrent writes, same-length overwrite, cross-bucket signatures, verified cleanup; writes a separate evidence file.
- `sigv4.cjs`: deliberately small research-only signer used to test local S3 semantics, not a proposed production SDK.
- `image-inspection.cjs`, `sanitizer.cjs`, `sanitize-worker.cjs`, `sanitizer-spike.cjs`: generated synthetic fixtures and separate Node decoder processes. No household photos, recognition adapter or AI responses.
- `evidence.test.cjs`: checks recorded evidence and known limitations. This does not replace live experiments or assert that known security failures are acceptable.
- `review-scan.cjs`: checks changed artifacts for actual local secrets and developer-specific paths, without printing credential values.

Run from the repository root using Node 24.19.0 and pnpm 11.19.0:

```sh
fnm exec --using 24.19.0 pnpm --dir tooling/scan-phase-a install --ignore-workspace --frozen-lockfile
fnm exec --using 24.19.0 pnpm exec jest tests/scan-phase-a-contracts.test.ts --runInBand
fnm exec --using 24.19.0 pnpm backend:start
fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/upload-spike.cjs
fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/upload-supplement.cjs
fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/sanitizer-spike.cjs
fnm exec --using 24.19.0 pnpm exec node --test tooling/scan-phase-a/evidence.test.cjs
fnm exec --using 24.19.0 pnpm exec node tooling/scan-phase-a/review-scan.cjs
fnm exec --using 24.19.0 pnpm backend:stop
```

The isolated manifest/lockfile pins Sharp; the mobile manifest and lockfile are unchanged. Initial installation used the available pnpm 11.26 resolver; the package now pins 11.19.0 and its frozen install was verified with that version. No app dependency or native package is added.

Never print `supabase status -o json`: it contains local credentials. The helper captures it in memory with stderr suppressed. The CLI's normal start output can also include local credentials; capture/suppress that output when using it in automated evidence runs. None of it belongs in the report or repository.

The upload experiment lasts about 605 seconds and keeps capabilities in process memory. It prints only test names/statuses/ages. Finally cleanup removes every generated path and identity, including late uploads after deletion. An externally killed process may not run finally; use the unique experiment prefix in local Storage inspection to remove only its fixtures before rerunning. The checked-in report contains no prefixes or credentials.

The sanitizer generates fixtures in an OS temporary directory with private file mode and removes them afterward. It logs only test names, safe failure codes, dimensions/byte counts and resource metrics. Decoder stderr is consumed without forwarding. It runs on Linux for `/proc` memory measurement. The 192 MiB monitor is a sampled kill threshold, **not an OS-enforced hard memory cap**; the report documents overshoot. Supervisor probes intentionally stall/allocate within a disposable child to test termination, separately from malformed-image decoder tests.

To rerun after editing, use the same commands; review any changed evidence rather than weakening expectations. Do not run these tests against hosted Supabase, introduce production credentials, or promote the prototype to a service without the separate authorization and security work listed in the report.

The original `scan-phase-a-upload.json` and `scan-phase-a-sanitizer.json` predate resumption and were preserved byte-for-byte. The resumed sanitizer runner writes `scan-phase-a-sanitizer-resumed.json` (49 cases), including the original corpus, GPS-tag presence, a broken JPEG pixel stream, XMP/ICC removal, and the revised 12 MP source limit. `prepare-candidate-24mp` is an explicit research comparison mode, excluded from the normal preparation policy. `processWallMs` includes worker startup and supervisor termination; `wallMs`/`cpuMs` cover the worker operation after module loading. Linux `/proc` high-water RSS and sampled RSS are reported separately from `rusageMaxRssKiB`; do not confuse a sampled limit with hard containment or use these single samples as p95 measurements.
