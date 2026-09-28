# Local trusted sanitizer

Phase F is a Linux/Docker implementation and local integration harness. It is not an upload endpoint, queue poller, hosted deployment, Storage transport, or recognizer. Processing admission remains disabled. See [the Phase F report](../../docs/research/SCAN_PHASE_F.md) for evidence and external gates.

Use Node 24.19.0, pnpm 11.19.0, Docker with cgroup v2 enforcement, and Linux `flock`. Install this package's frozen lockfile independently of the mobile app:

```sh
pnpm --dir server/sanitizer install --frozen-lockfile
docker build -t kitchencam-sanitizer:phase-f server/sanitizer
node node_modules/typescript/bin/tsc -p server/sanitizer/tsconfig.json
node --test --test-concurrency=1 server/sanitizer/tests/*.test.ts
```

Run tests from the repository root with the local Supabase stack running. Integration tests discover local service credentials without printing them, create synthetic fixtures, and remove their own rows. Resource probes deliberately exhaust container memory, CPU, PIDs and temporary disk; they never change the production limits. Set `PHASE_F_EVIDENCE` to a local JSON filename to record resource results.

A trusted operator can create a store with `node server/sanitizer/cli.ts init /tmp`. Bind a registered raw-image ID and digest to synthetic bytes by calling `new Store(root).import(bytes)`; this returns an opaque input reference. The local CLI reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only in the coordinator environment, accepts loopback HTTP only, and executes:

```sh
node server/sanitizer/cli.ts run ROOT SCAN_ID INPUT_REFERENCE
node server/sanitizer/cli.ts recover ROOT
```

`run` claims a sanitizer lease using the existing Phase B RPC. The coordinator admits source bytes, binds their digest to the claim, runs an encoder and a fresh verifier container, publishes an exclusive local output, then asks the database to approve it. Only an acknowledged database success returns `SUCCESS`. The database remains authoritative after cancellation or expiration, even if an HTTP request times out. A lost acknowledgement returns `PENDING` and preserves the output and journal. Never infer approval from the mere existence of a local JPEG.

The container receives a read-only source-file mount and no credentials, host environment, network, output directory or Docker socket. Sharp/libvips is installed only in this server package. The decoder communicates bounded bytes over stdout and an allowlisted resource/category record over stderr. The fresh verifier is a separate process using the same decoder library, not independent-library validation. Logs contain no raw errors, image bytes, paths, metadata, digests, leases or credentials.

One kernel lock serializes import, processing and recovery per store. It releases when a coordinator dies. At most one incoming image and sixteen obligation journals are admitted. Source input is capped at 25 MiB/12 MP; output at 4 MiB/2048 long edge with a 256 minimum short edge. Host artifact limits are enforced by this trusted coordinator, not by an OS filesystem quota. The decoder's tmpfs is OS bounded. Recovery removes orphan intermediates and retains ambiguous/approved artifacts until Phase B cleanup claims their registered IDs. Acknowledgement follows physical deletion; false/failed acknowledgements retain the journal. Unknown inventory IDs and returned paths never authorize local file deletion.

Use one exclusive local store/database harness. The global Phase B cleanup RPC has no store selector. A future distributed Storage adapter must coordinate claims, reconcile acknowledgement loss, and own scheduling and retention. If the database commits cleanup but its acknowledgement is lost, local bytes are already removed; the bounded journal may require operator reconciliation. Do not erase an uncertain journal merely to admit more jobs. Hosted immutable publication, durable-volume behavior, fleet cleanup and daemon-failure recovery require their own validation before enabling processing.
