# KitchenCam

Mobile and local Supabase engineering foundations for the approved KitchenCam MVP. Phase 0 research gates remain open. No production infrastructure or product integrations are configured.

## Local development

Use Node 24.19 and pnpm 11.19 (pinned in `.node-version` and `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm web
pnpm check
pnpm deps:check
pnpm doctor
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
pnpm db:types
pnpm backend:stop
```

Local email is captured by Supabase Inbucket; it is not delivered externally. `db:types` replaces `src/types/database.generated.ts` only after successful generation. This workstation still needs a compatible container runtime before those runtime checks can close.

`pnpm start` serves an installed Expo development client. `pnpm android` / `pnpm ios` open that client on a configured emulator/simulator. These commands do not build or sign a client. Native SDK/signing setup is still required for device validation. The browser preview is a layout aid, not proof of native behavior.

## Engineering references

- [Foundation implementation and route reservations](docs/ENGINEERING_FOUNDATION.md)
- [Local backend and authentication foundation](docs/BACKEND_FOUNDATION.md)
- [Roadmap and blocked gates](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Design and accessibility](docs/UX_FOUNDATION.md)
- [Security](docs/SECURITY.md)

Application code lives in `src/`; `app/` contains Expo Router composition only. Local database code lives in `supabase/`. Tests live outside the route tree. Add external service integrations only in a separately approved task.
