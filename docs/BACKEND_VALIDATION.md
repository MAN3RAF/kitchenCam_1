# Backend foundation validation — 2026-09-20

Local runtime validation is complete. The repaired backend foundation is suitable for an owner-reviewed local development checkpoint. This is not production approval. No remote Supabase project, production connection, production credential, new product feature, commit, or push was created.

| Requested result | Evidence and outcome |
| --- | --- |
| 1. Environment versions | Project commands used Node **24.19.0** and pnpm **11.19.0**, matching `.node-version`, the Node engine range, and `packageManager`. Docker CLI/daemon **29.8.1**, Compose **5.5.1**, Supabase CLI **2.117.0**, PostgreSQL **17.6**, Edge runtime **1.74.3** / Deno **2.1.4**. Docker daemon access succeeded without sudo. |
| 2. Local startup | `pnpm backend:start` passed. Auth, PostgreSQL, Storage, REST, gateway, Studio, local email capture, and Edge runtime ran locally. Function serving was also exercised explicitly. |
| 3. Migration replay | `pnpm db:reset` recreated PostgreSQL and replayed all four original migrations plus `20260920010400_runtime_validation_fixes.sql`. The database migration ledger confirmed all five versions. |
| 4. Database/pgTAP | `pnpm db:test`: **71/71 assertions**, five files. Schema 20, identity RLS 12, storage 9, lifecycle 17, merge security 13. `pnpm db:lint`: no findings with `--fail-on warning`. |
| 5. RLS | Actual permanent User A and anonymous User A could read their own profile/preferences and could neither read nor update User B's rows. B's values remained unchanged. Deletion-pending accounts immediately lost access. Other clients could not read or resolve the owner's merge review. |
| 6. Storage security | Both buckets were populated using the service role, with a successful service download as a positive control. Signed-out, permanent, and anonymous clients obtained no listing results and were denied download, signed-URL creation, and upload. SQL storage-policy tests also passed. |
| 7. Authentication | Anonymous sign-in and both six-digit OTP flows passed: guest-to-email upgrade and sign-in to an existing permanent account. Email stayed in local capture; the pinned CLI currently runs Mailpit at its Inbucket-compatible URL. Upgrade preserved the user ID and existing profile data. Web-adapter session restoration and refresh passed. The native adapter also restored/refreshed a real session and removed every stored chunk using a host SecureStore substitute. |
| 8. Merge/deletion | Wrong-account reuse, expired/unknown tickets, stale guest JWT issuance after upgrade, consumption of an upgraded source, replacement of a claimed ticket, and upgrade between claim and cleanup were rejected. Same-owner retry did not duplicate the transfer event. The UI required exact `DELETE` confirmation. Recent-auth enforcement, irreversible account lockout, Auth deletion, minimized completion records, repeated completion, and rejection of deleted sessions passed. Cleanup removed 1,001 flat objects plus a nested object. |
| 9. Edge Functions | All three functions were exercised with successful operations and authentication/validation failures. All **10/10** runtime integration tests passed. Deno 2.1.4 type checking passed for all three entry points; Deno lint passed for all nine source files. JWT verification remained enabled. |
| 10. Generated database types | Generated `src/types/database.generated.ts` from the real local schema: **334 lines**. `pnpm db:types:check` confirmed byte-for-byte agreement with a fresh generation. SHA-256: `bc3adc6f32e4ac70f1d3284ce8064a4e775edae2736f91e9c65f3c172f8ef0d9`. The existing CI Git-tracking gate intentionally remains pending until the owner checkpoints this new file. |
| 11. Full project validation | `pnpm check` passed TypeScript, ESLint, Prettier, **16 Jest tests in six suites**, and **eight static boundary/security tests**. `pnpm deps:check` passed. `pnpm run doctor` passed **21/21** Expo checks. `pnpm export:check` exported Android, iOS, and web successfully. |
| 12. Failures/fixes | Implementation, test, and tooling findings are detailed below. Affected tests were rerun successfully; original migrations and client security restrictions were preserved. |
| 13. Security findings | Fixed server-key acceptance in public configuration, the upgraded-source merge deletion vulnerability, and incomplete storage deletion. Private operational-table and service-only RPC denial passed for permanent and anonymous sessions. The exported artifacts contained no injected server canaries or actual local server credentials. |
| 14. Remaining gates | Real-device and remote/operational gates remain listed below. No local runtime failure remains open. |
| 15. Git diff/status | HEAD remains `c077872` (`progress`), preceded by `d8d2159` (`Initial commit`). The tree was already dirty at entry and remains dirty for review. No staging, commit, push, or history rewrite was performed. `git diff --check` passed. |
| 16. Checkpoint decision | **Yes, for the local backend foundation after owner review**, including the repaired code, tests, generated types, and Deno lockfile. Production readiness and native-device approval remain deferred. |

## Environment qualifications

The raw Codex shell initially selected system Node **26.9.0**, outside the repository requirement. Every project workflow instead used `fnm exec --using 24.19.0 pnpm …`; a subprocess confirmed `pnpm/11.19.0` and `node/v24.19.0`. The shell's default selection was not changed.

Sandboxed pnpm could not open its package-manager database, and sandboxed Docker could not access its socket. Both succeeded through the approved execution environment without sudo. These were tooling restrictions, not application failures.

The initial Git baseline contained modifications to `supabase/tests/database/account_lifecycle.test.sql`, `tests/client-boundary.test.cjs`, and `tests/public-env.test.ts`, plus untracked `tests/backend-runtime.test.cjs`. Those changes were preserved, used, and extended. In particular, the existing lifecycle test repair moved privileged table inspection out of the authenticated role while retaining an explicit denial assertion.

## Defects repaired

- **Ambiguous merge SQL:** initial pgTAP failed six of 58 assertions; lint identified SQLSTATE `42702`. Qualified review columns and a named conflict constraint now avoid collisions with function output variables. The repair is a new forward migration.
- **Upgraded identity could be deleted through an old guest ticket:** the live regression initially received success where denial was required. Issuance and consumption now check live Auth state; source row locking serializes consumption against upgrade; a trigger prevents upgrade after claim; claimed tickets cannot be replaced. SQL and HTTP regressions now pass.
- **OTP configuration:** disabled email confirmation caused guest upgrades to produce no email code. Local confirmation is now enabled. The actual app auth-service functions completed both email flows against local Auth and captured mail.
- **Incomplete deletion cleanup:** the original implementation listed only 1,000 root objects and ignored folders. A populated regression proved that it falsely completed with objects remaining. Cleanup now traverses folders and repeatedly drains the first page. Processing-state RPC failures are also handled. A service-only SELECT grant permits inspection of minimized privacy completion records; no client grant or storage policy was relaxed.
- **Public configuration accepted server credentials:** build-time and runtime validators now accept only publishable-key syntax. Existing negative tests pass. Actual Expo configuration was also checked with a local service-role JWT, local secret key, and a provider-secret canary; each failed without printing the value. This follows Supabase's distinction between [publishable and server-only API keys](https://supabase.com/docs/guides/getting-started/api-keys).
- **Validation workflow gaps:** database lint previously returned exit code zero despite reporting an error; it now fails on warnings. Added explicit runtime-test and generated-type comparison scripts and CI steps. `pnpm doctor` invoked pnpm's built-in diagnostic; documentation and CI now use `pnpm run doctor` to select Expo Doctor. Missing Node `Buffer` imports and an incomplete test mock were corrected without weakening assertions.
- **Runtime reload interference:** an initial rerun used the startup runtime's cached function code. Explicit function serving loaded the repair. A later Deno lockfile creation triggered the watcher during tests and caused gateway/storage failures. After Deno finished and the runtime stabilized, all ten integration tests passed. Deno's generated dependency lockfile is included for review.

## Security evidence and limits

The bundle check ran the existing all-platform export with the real local public URL/publishable key plus five harmless server-secret canaries. It scanned all **57 output files**, including Android/iOS Hermes bytecode and web JavaScript, for those canaries and the actual local server credential values. None were present; the public key was present as a positive control. This validates the current source and export path, not every possible future code change.

Merge tokens are bearer capabilities until first claim. The successful wrong-account tests prove that a claimed ticket stays bound to its authenticated target; the existing design does not prebind an unclaimed ticket to an intended email address. Same-target retries are deliberately allowed and do not repeat transfer effects. Email equality alone does not authorize a merge.

Deletion immediately prevents client data access. Repeating storage removal and internal completion is safe; a deleted Auth session is rejected rather than allowed to reopen the account. Final fixture inspection found **zero Auth users and zero storage objects** remaining. Production crash recovery, scheduled retries, and failure injection at every cleanup boundary are not claimed by these local tests.

## Genuinely unvalidated/deferred gates

- Real iOS/Android secure-store hardware behavior, device restart/reinstall persistence, actual app deep-link/magic-link dispatch, native OTP UI, VoiceOver/TalkBack, signed builds, and provider sign-in. The native adapter test uses a host storage substitute.
- Remote development/staging/production projects, region selection, SMTP delivery, provider credentials, production secrets, backup/restore, alerts, and named operational ownership. These were explicitly outside this task.
- Production retry workers and crash recovery for merge/deletion cleanup, account export, and abandoned-anonymous-user cleanup scheduling. No new worker or product feature was implemented.
- Actual hosted CI execution and the generated file's Git-tracking/clean-diff gate after the owner checkpoints the changes. Local generation consistency is verified.
- Existing Phase 0 gates and deferred features in `ROADMAP.md` remain unchanged.

The local stack was stopped with the repository's `backend:stop` workflow after validation. Work stops here for owner review.
