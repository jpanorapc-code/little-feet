# Little Feet production-readiness audit

Audit date: 30 September 2026

Audited base: `620a8c16e02636d6e8b8caea8207a987a6a2f15e`

Audit branch: `codex/final-readiness`

This report distinguishes tested evidence from external work that still requires production infrastructure. It is not a security certification or a guarantee that the application is bug-free.

## Current launch-readiness decision

- **VERIFIED:** local application regression, role authorization, tenant isolation, restart persistence, bounded imports, private-file lifecycle, browser runtime, responsive layout, dependency audit, secret-history scan, capacity smoke testing, production Cloudflare R2 configuration, a live private upload/retrieval, the one-account owner cutover, an isolated coordinated PostgreSQL + R2 recovery rehearsal, scheduled production monitoring, GitHub CI for the deployed audit head, and observed Render deployment health.
- **UNVERIFIED:** production SMTP delivery was configured by the owner but was not independently resent during this continuation; live Google/Microsoft sign-in and mailbox authorization, production PostgreSQL query plans, browser streaming of very large XLSX files, and manual testing on representative physical devices remain unverified.
- **BLOCKED / NOT APPLICABLE:** no SMS provider or automatic payment provider is configured, so live SMS and payment-webhook delivery cannot be validated. Independent penetration testing, POPIA operational review, and representative physical-device testing require external people or devices.
- **FAILED:** none in the final local suite recorded below.

The application must not be described as certified or guaranteed bug-free. The audited `9192ae7` head was observed live on Render and used for the successful recovery rehearsal; the final pool/report commit must still pass CI and be observed after deployment.

## Temporary, demo, static, and duplicate functionality

The audit found and addressed these items:

1. A historical `saveStickyNote is not defined` runtime-error ticket remained in persisted ticket and inbox data after the real sticky-note implementation had been fixed. The exact obsolete ticket and its derived inbox item are removed during migration. New runtime errors remain visible and are not muted.
2. Deleted inbox copies could be regenerated from their source records. Persistent inbox dismissals now prevent that regeneration while leaving the original ticket, message, notice, or safety record intact.
3. Learner import progress was request-local. Imports now use persistent, tenant-owned jobs with bounded batches, progress, replay-safe batch identifiers, resume support, and partial-failure results.
4. Post and worksheet images could be stored as large data URLs in the application database. When private object storage is configured, new images are stored as private objects with database-owned relationships. Existing data-URL records remain readable for backward compatibility.
5. A disconnected subscription modal and its child handlers had no element, string, navigation, or callable reference. Five other single-occurrence functions were also proven unreferenced. These functions were removed after repository-wide identifier and markup checks.
6. Fourteen superseded media files had zero references across application code, styles, tests, and markup. Their current 4K replacements remain active. Removing the orphaned copies reduces the repository by about 20 MiB.
7. The deployed database contained three prior accounts when the cutover ran. A one-time, ID-tracked migration replaced the account list with one configured CEO administrator, hashed the supplied password, invalidated every persisted session, and queued private staff-file cleanup for removed accounts across all schools. The Render migration log recorded removal of all three previous accounts and the new owner login was verified. The real credential was supplied only through protected Render environment settings and is not stored in Git.
8. Parent subscription ordering existed on the server but had no connected parent checkout in the portal. The Parent Payments workspace now shows live Basic/Plus status, creates a real payment request, and refreshes role access after a confirmed payment. School subscription requests now expose an administrator-only cleared-payment action; exact reference and amount validation activates the school's selected plan. A signed provider webhook can perform the same transition when a provider is configured.
9. The historical release feed used unrelated 2.x, 3.x, 8.2.9, and 9.0 labels and generated infrastructure wording. It now resets to a single user-facing Version 1.0 production-foundation update. A dedicated baseline marker keeps this deployment at 1.0 and automatically advances later deployed commits to 1.0.1, 1.0.2, and so on while continuing to derive each update title and description from the deployed release.

Template rows labelled “Example” remain intentionally in downloadable spreadsheet templates. They are not inserted into production data. Empty-state copy, input placeholders, and test fixtures also remain because they do not pretend to be live records.

Repeated controls were compared by action, target workspace, allowed roles, and context. Repeated audio controls, setup/tour shortcuts, and finance/payment shortcuts are intentional access points. None were removed because each serves a different screen or role context.

## Database validation

The current persistence model was inspected rather than replaced:

- PostgreSQL stores collection records in `little_feet_records` as JSONB with `collection`, `record_key`, `school_id`, timestamps, uniqueness, and school/collection indexes.
- Metadata uses `little_feet_metadata`; sessions use `little_feet_sessions`.
- Writes use a transaction and an application-level serialized save chain. Deletes are reconciled against the previous persistence snapshot.
- SQLite is the local fallback. A read-only JSON replica remains available for standby behavior.
- Tenant ownership is migrated onto persisted records and enforced through the existing school helpers.
- Local restart persistence and replica restoration were tested successfully.

The PostgreSQL model remains a generic JSONB record store rather than a fully normalized relational schema. Application validation and tenant checks therefore carry more responsibility than database foreign keys. A migration to normalized domain tables was not attempted because it would be a high-risk rewrite of interconnected working features.

The production PostgreSQL data was captured and restored into an isolated schema during the coordinated recovery rehearsal described below. Direct production query-plan inspection remains **UNVERIFIED** because the rehearsal inventories the relevant indexes but does not run representative `EXPLAIN (ANALYZE)` statements against live traffic.

## Cloudflare object-storage architecture

The implementation uses a private Cloudflare R2 bucket through its S3-compatible API. The browser receives no R2 credential and no permanent public object URL.

PostgreSQL metadata contains:

- application file ID;
- school/tenant ID;
- related entity type and record ID;
- generated storage key under a hashed tenant prefix;
- safe original filename;
- validated content type and byte size;
- SHA-256 integrity digest and object ETag;
- uploader, timestamps, replacement relationship, and access lifecycle state.

Private content is retrieved through `/api/files/:id/content`. The application requires a valid session, same-school ownership, and authorization to the related learner, staff, school, post, or worksheet record. An object key is never treated as authorization.

Replacement writes the new object and metadata before retiring the old object. Deletion persists a pending state before deleting bytes. School and staff deletion create durable cleanup jobs so failed object deletion can be retried after restart. An administrator-only integrity endpoint checks active objects for missing data or size disagreement.

Required server-only configuration:

- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET`

Production R2 is configured with a private bucket and bucket-scoped read/write credentials. A live 68-byte PNG upload created protected file metadata and the portal retrieved it successfully through `/api/files/:id/content` with the expected dimensions. Replacement, deletion, integrity disagreement, missing-object, restart, and cross-tenant cases passed against the same adapter in the automated lifecycle suite. The coordinated production-data recovery rehearsal copied and restored the live R2 probe in the isolated recovery bucket and verified its hash before cleanup.

## Upload restrictions

Ordinary private files use one file per bounded JSON request. The global API request limit defaults to 8 MiB and is capped at 10 MiB.

| Type | Accepted extensions | Maximum decoded size |
| --- | --- | ---: |
| PNG | `.png` | 5 MiB |
| JPEG | `.jpg`, `.jpeg` | 5 MiB |
| GIF | `.gif` | 5 MiB |
| WebP | `.webp` | 5 MiB |
| PDF | `.pdf` | 5 MiB |
| Plain text | `.txt` | 2 MiB |
| CSV | `.csv` | 2 MiB |

The server checks the data-URL encoding, declared content type, allowed extension, decoded size, and content signature or text safety. Filenames are reduced to safe leaf names and generated object keys prevent traversal and collisions. Unsupported, mismatched, empty, or oversized files are rejected.

Spreadsheet limits:

- learner register: 50 MiB client file limit, 100,000 rows per file, 250-row browser batches, 500-row server maximum per batch, 400 batches per job;
- schedules: 8 MiB and 2,000 rows;
- attendance: 8 MiB and 2,000 rows;
- book register: 8 MiB and 2,000 rows;
- bank reconciliation: 5 MiB and the first 500 bounded statement lines.

Schedule, attendance, and book-register endpoints now reject oversized arrays instead of silently truncating them.

## Large school imports

Learner imports use a stable import ID, batch number, declared total batch count, tenant ownership, creator ownership, duplicate detection, field validation, encrypted sensitive fields, replay-safe results, progress retrieval, and restart persistence. A repeated response or retry does not process the same batch twice. Up to 100 completed jobs per school are retained; older completed job/audit records are pruned. Rejected-row details are sampled to 100 rows per batch while total rejected counts remain accurate, preventing an invalid file from creating an unbounded in-memory audit record.

The browser still parses XLSX files locally with SheetJS before batching. Very large workbooks therefore require adequate browser memory; streaming XLSX parsing is **UNVERIFIED** and would require a separate worker/streaming design.

## Performance findings and changes

- Broadcast, ticket, health, release, and email polling now pauses when the page is hidden.
- Initial loading remains demand-based to avoid a burst of every workspace request at login.
- Fourteen unused legacy media files were removed, reducing checkout and build transfer size by about 20 MiB.
- Import request sizes, persistent job history, and rejected-row samples are bounded.
- The existing PostgreSQL indexes on school and collection ownership were retained.
- The production PostgreSQL session pool is now capped at six connections and defaults to five. This keeps two briefly overlapping Render instances below the provider's 15-client session-mode limit during rolling deployments and leaves capacity for the isolated recovery job.
- The Email workspace now supports real read-only Google Gmail and Microsoft Outlook mailbox connections. OAuth authorization uses state plus PKCE, renewable provider tokens are encrypted with the server field-encryption key, connections are owned by the exact signed-in Little Feet user, and provider message IDs prevent duplicates. The first request imports 100 inbox messages by default. Each later check imports up to 50 newest messages plus one bounded 50-message backlog page until the current inbox has been covered. While the Email workspace is open, it checks every 60 seconds. Existing provider forwarding remains available for Zoho, Yahoo, and other providers without a supported mailbox API.
- Provider HTTP exchanges, Gmail/Graph response conversion, refresh-token handling, UI/server route wiring, inbox deduplication rules, and token redaction were covered by automated regression checks. **Live authorization remains UNVERIFIED** until the production Google project enables Gmail API with the `gmail.readonly` consent scope and the production Microsoft app enables delegated `Mail.Read` plus `offline_access`; both applications must register the callback URLs documented in `.env.example`.

Capacity smoke result: 1,500 school tenants, two 1,000-learner schools, and 500 sustained requests at up to 90 concurrent connections passed in 5,010 ms on the final local test host. This is a smoke measurement, not a production load guarantee.

The Render service now uses the 0.5 CPU / 512 MiB paid instance selected by the owner. Production capacity remains subject to real traffic and provider limits.

## Security findings and changes

- Private file reads and mutations enforce authentication, relationship authorization, school ownership, safe names, content validation, size limits, and integrity hashes.
- Cross-school private-file access returns no data.
- Staff and school deletion now include durable private-object cleanup.
- Import jobs enforce school and creator ownership and bounded replay-safe batches.
- A one-time owner reset is explicit, fails closed when required values are missing, records its migration ID, cannot reapply after restart, removes old sessions, and never logs or commits the password.
- Signed or administrator-reconciled payment events activate the matching parent or school subscription only after exact amount/reference validation. Parent Plus access lasts 30 days, is visible to an existing signed-in session, and repeated provider events cannot extend access twice.
- Existing session regeneration, secure/httpOnly/SameSite production cookies, same-origin mutation checks, security headers, login throttling, tenant checks, encrypted sensitive fields, signed payment webhooks, and output escaping were retained.
- The dependency audit reports zero known vulnerabilities in the locked dependency graph.
- Git history secret-pattern scanning reports no discovered committed credential pattern.

The application still relies on application-layer role and tenant checks across a large route surface. Independent penetration testing and code review remain recommended before processing sensitive school data at scale.

## Backup and restore strategy

PostgreSQL metadata and R2 bytes form one recovery set. Writes should be paused, a common timestamp and application SHA recorded, PostgreSQL backed up, and the R2 `schools/` inventory/objects copied or versioned. Restore PostgreSQL first and R2 second while writes remain paused, then run authenticated integrity checks before reopening writes. A database-only or bucket-only restore is incomplete.

The complete procedure is documented in `docs/production-storage.md`.

**VERIFIED on 30 September 2026:** recovery set `20260930T101109028Z-486f8384` was created from deployed application SHA `9192ae72f2f6fa04ea28b264d97e5b4423dbc6b2`. Four PostgreSQL tables containing 34 rows were encrypted to the separate private R2 recovery bucket, restored into a generated isolated PostgreSQL schema, and row-count checked. One R2 probe object was copied, restored under an isolated prefix, size/hash checked, and removed. The isolated schema and restored-object prefix were removed successfully; the encrypted recovery set and manifest remain as the offsite recovery artifact. Total rehearsal time was 3.84 seconds.

The recovery bucket uses a dedicated account token restricted to Object Read & Write for `little-feet-private-prod` and `little-feet-recovery-prod`. Credentials remain server-side in Render and are not committed to Git.

Production monitoring is also **VERIFIED**: `.github/workflows/production-monitor.yml` checks health, readiness, and database keepalive. Nine scheduled runs were visible as successful through 30 September 2026; the most recent observed run completed in seven seconds.

## Tests executed from the final local code state

- `npm test`: passed all 24 scripted regression stages, including route connections, authentication migration, OAuth identity matching, inbound email forwarding, mailbox OAuth/provider conversion, tenant isolation, security, replica restore, one-time owner reset, storage lifecycle, imports, cinematic navigation, web quality, adversarial entry points, authorization matrix, Render metadata, finance, preferences, and legal notices.
- Owner-account migration: two prior accounts were replaced with one administrator, both prior credentials were rejected, the new credential authenticated, and restart/idempotency behavior passed using test-only credentials.
- Subscription activation: signed payment notification, Basic-to-Plus activation, existing-session refresh, 30-day access date, duplicate provider-event protection, tenant isolation, school-plan activation, and paid-status display passed.
- Private storage lifecycle: upload, validate, persist, retrieve, cross-tenant denial, replace, old-object denial, restart persistence, staff-account cleanup, related-post cleanup, and malicious filename handling passed.
- Import lifecycle: validation, duplicate handling, idempotent replay, completion, tenant denial, request limits, and restart persistence passed.
- Capacity smoke: passed with the measurement stated above.
- Browser role audit: admin 43, principal 42, teacher 36, parent 17, district 12 navigation controls; zero missing handlers and zero runtime errors.
- Responsive audit: 1,118 tab/state/viewport checks passed across 13 phone, tablet, landscape, desktop, and TV sizes.
- Ambient/background browser regression: passed for all five roles with zero runtime errors.
- `npm audit --audit-level=high --package-lock-only`: zero vulnerabilities.
- Git history secret-pattern scan: passed.
- JavaScript syntax and diff hygiene checks: passed.

CI status: the final branch must pass GitHub `verify` before merge; the result will be recorded on the pull request.

## Manual and external validation still required

1. Inspect representative production PostgreSQL query plans under controlled load.
2. Independently revalidate SMTP delivery, register both mailbox callback URLs, approve the documented read-only mailbox scopes, and complete Google/Microsoft sign-in and mailbox authorization with real provider accounts. No SMS provider exists to test.
3. Validate a signed payment webhook only after an automatic payment provider is selected and configured. The tested administrator-reconciled bank-transfer path remains available.
4. Test representative physical Android, iOS, tablet, desktop, and accessibility-assistive devices.
5. Run independent security review/penetration testing and confirm POPIA operational procedures with the responsible organization.
6. Observe the final Render deployment and production health/readiness endpoints after the final commit and again after merge. A successful prior deployment is not deployment verification for a later code state.

## Configuration required before launch

At minimum: `NODE_ENV`, `DATABASE_URL`, `SESSION_SECRET`, `LF_FIELD_ENCRYPTION_KEY`, the four `CLOUDFLARE_R2_*` variables, a production administrator, and approved payment destination. The offsite R2 recovery target, dedicated recovery credentials, encryption key, rehearsal marker, and GitHub Actions production monitor are configured and tested. `LF_PAYMENT_WEBHOOK_SECRET` is required only when an automatic payment provider is configured. Optional SMS and OAuth providers require their documented secrets.

The requested account cutover completed successfully. Remove the temporary `LF_OWNER_*` values and obsolete `LF_BOOTSTRAP_ADMIN_*` values from Render after verification; the database migration record prevents replay. Keep only ordinary runtime configuration and the four R2 variables.

## Standby replication work after the audited base

The original standby process selected port 5001 by default and ignored Render's injected `PORT`, and its replica loader could only read a JSON file on that process's own disk. Therefore the previous code could not serve as a separate Render standby using the available deployment configuration.

The current branch adds encrypted R2 snapshot transport, publishes after durable application-state saves, has the separate standby poll and validate the latest snapshot, exposes replica freshness and code-SHA readiness, refuses browser redirection when the standby is missing/stale/incompatible, and makes `backup-server.js` honor Render's `PORT`. Business mutations on standby remain HTTP 503/read-only. Its snapshot includes the application state, not live PostgreSQL session rows; users must sign in again after failover.

Automated local verification covers transport encryption/publish/load between independent instances, updated snapshots, wrong-key and corruption rejection, refusal to claim failover readiness without remote R2, local HTTP standby restore, and Render port forwarding. Final `npm test` passed all listed regression stages from this branch, including both standby-specific tests; syntax checks and `git diff --check` also passed. This does not change the older successful coordinated PostgreSQL/R2 recovery rehearsal above.

The first PR CI attempt passed syntax and browser tests but the repository integrity audit classified `/runtime-config.js` as a missing static file. That audit now recognizes it as a server-generated route; the updated project-integrity audit and full local regression suite pass. The follow-up GitHub CI run is pending.

**Live failover remains BLOCKED:** the code cannot create/configure the separate Render service or install its protected R2 credentials. Create the standby service from this same repository and `main` branch with automatic deploy enabled; set `LF_REPLICA_MODE=1`, matching recovery bucket and encryption key, scoped R2 permissions, and its health check. On primary, set `LITTLE_FEET_BACKUP_URL` to the standby HTTPS origin. After both deploy the same commit, verify `/api/failover-readiness` reports `ready: true`, a current snapshot and matching SHA, then test browser redirect. The standby intentionally does not accept business writes: a genuinely writable automatic failover still requires traffic-controller support and a primary fencing/lease mechanism to prevent split-brain. No automatic DNS/server-side failover or safe writer promotion is claimed.

