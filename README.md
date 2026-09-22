# KitchenCam

Mobile and local Supabase engineering foundations for the approved KitchenCam MVP. Phase 0 research gates remain open. No production infrastructure or product integrations are configured.

## Local development

Use Node 24.19 and pnpm 11.19 (pinned in `.node-version` and `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm web
pnpm check
pnpm deps:check
pnpm run doctor
pnpm export:check
```

The shell runs without an `.env` file. `.env.example` documents the public environment selector and optional local Supabase URL/publishable key. Never add service-role keys or provider secrets to an Expo public variable.

The local backend requires Docker Desktop or another Docker-compatible runtime:

```sh
pnpm backend:start
pnpm backend:status
pnpm db:reset
pnpm db:test
pnpm db:lint
pnpm backend:test
pnpm backend:test:scan
pnpm db:types
pnpm db:types:check
pnpm backend:stop
```

Local email is captured by the CLI email service (currently Mailpit at the Inbucket-compatible local URL); it is not delivered externally. `db:types` replaces `src/types/database.generated.ts` only after successful generation. `db:types:check` compares a fresh generation without changing the file. Local runtime validation is recorded in [the backend validation report](docs/BACKEND_VALIDATION.md).

`backend:start` starts the Edge runtime. After editing functions, run `pnpm backend:functions` in a separate terminal to reload and watch them before running `pnpm backend:test`. Avoid changing function files or generating the Deno lockfile while runtime tests are in progress.

`pnpm start` serves an installed Expo development client. `pnpm android` / `pnpm ios` open that client on a configured emulator/simulator. These commands do not build or sign a client. Native SDK/signing setup is still required for device validation. The browser preview is a layout aid, not proof of native behavior.

## Engineering references

- [Foundation implementation and route reservations](docs/ENGINEERING_FOUNDATION.md)
- [Local backend and authentication foundation](docs/BACKEND_FOUNDATION.md)
- [Camera/scan Phase A contracts and local security/runtime evidence](docs/research/SCAN_PHASE_A.md)
- [Phase B scan schema, lifecycle controls and validation](docs/research/SCAN_PHASE_B.md)
- [Roadmap and blocked gates](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Design and accessibility](docs/UX_FOUNDATION.md)
- [Security](docs/SECURITY.md)

Application code lives in `src/`; `app/` contains Expo Router composition only. Local database code lives in `supabase/`. Tests live outside the route tree. Add external service integrations only in a separately approved task.
