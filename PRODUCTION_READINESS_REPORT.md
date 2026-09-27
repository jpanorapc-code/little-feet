# Little Feet production-readiness audit

Audit date: 27 September 2026  
Audited base: `fd1f095e923ba630a3e17fbd56ae2eb86bb46c7f`  
Audit branch: `codex/production-readiness-audit`

This report distinguishes tested evidence from external work that still requires production infrastructure. It is not a security certification or a guarantee that the application is bug-free.

## Current launch-readiness decision

- **VERIFIED:** local application regression, role authorization, tenant isolation, restart persistence, bounded imports, private-file lifecycle, browser runtime, responsive layout, dependency audit, secret-history scan, and capacity smoke testing pass from the audited code state.
- **UNVERIFIED:** live PostgreSQL backup/restore, live Cloudflare R2 operations, production email/SMS/OAuth/payment delivery, and manual testing on physical devices.
- **BLOCKED:** production Cloudflare R2 configuration and credentials; a coordinated production PostgreSQL + R2 recovery rehearsal; CI and deployment verification until the audit branch is pushed.
- **FAILED:** none in the final local suite recorded below.

The application must not be described as fully launch-ready until the blocked production checks are completed. No current production deployment of this audit branch is claimed.

## Temporary, demo, static, and duplicate functionality

The audit found and addressed these items:

1. A historical `saveStickyNote is not defined` runtime-error ticket remained in persisted ticket and inbox data after the real sticky-note implementation had been fixed. The exact obsolete ticket and its derived inbox item are removed during migration. New runtime errors remain visible and are not muted.
2. Deleted inbox copies could be regenerated from their source records. Persistent inbox dismissals now prevent that regeneration while leaving the original ticket, message, notice, or safety record intact.
3. Learner import progress was request-local. Imports now use persistent, tenant-owned jobs with bounded batches, progress, replay-safe batch identifiers, resume support, and partial-failure results.
4. Post and worksheet images could be stored as large data URLs in the application database. When private object storage is configured, new images are stored as private objects with database-owned relationships. Existing data-URL records remain readable for backward compatibility.
5. A disconnected subscription modal and its child handlers had no element, string, navigation, or callable reference. Five other single-occurrence functions were also proven unreferenced. These functions were removed after repository-wide identifier and markup checks.
6. Fourteen superseded media files had zero references across application code, styles, tests, and markup. Their current 4K replacements remain active. Removing the orphaned copies reduces the repository by about 20 MiB.
7. The deployed database contained two prior accounts that the owner asked to replace. A one-time, ID-tracked migration now replaces the account list with one configured CEO administrator, hashes the supplied password, invalidates every persisted session, and queues private staff-file cleanup for removed accounts across all schools. The real credential is supplied only through protected Render environment settings and is not stored in Git.
8. Parent subscription ordering existed on the server but had no connected parent checkout in the portal. The Parent Payments workspace now shows live Basic/Plus status, creates a real payment request, and refreshes role access after a confirmed payment. School subscription payments now update the visible order state and the school's active plan rather than continuing to display “awaiting payment.”
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

**BLOCKED — REQUIRES PRODUCTION DATABASE ACCESS:** direct inspection of the live PostgreSQL instance, production query plans, a production backup, and a timed restore rehearsal.

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

**BLOCKED — REQUIRES PRODUCTION CLOUDFLARE CONFIGURATION:** create the private bucket and bucket-scoped read/write credentials, configure Render, deploy, upload/retrieve/replace/delete a test object, and run the integrity endpoint.

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

Capacity smoke result: 1,500 school tenants, two 1,000-learner schools, and 500 sustained requests at up to 90 concurrent connections passed in 5,381 ms on the final local test host. This is a smoke measurement, not a production load guarantee.

## Security findings and changes

- Private file reads and mutations enforce authentication, relationship authorization, school ownership, safe names, content validation, size limits, and integrity hashes.
- Cross-school private-file access returns no data.
- Staff and school deletion now include durable private-object cleanup.
- Import jobs enforce school and creator ownership and bounded replay-safe batches.
- A one-time owner reset is explicit, fails closed when required values are missing, records its migration ID, cannot reapply after restart, removes old sessions, and never logs or commits the password.
- Signed payment events activate the matching parent or school subscription only after exact amount/reference validation. Parent Plus access lasts 30 days, is visible to an existing signed-in session, and repeated provider events cannot extend access twice.
- Existing session regeneration, secure/httpOnly/SameSite production cookies, same-origin mutation checks, security headers, login throttling, tenant checks, encrypted sensitive fields, signed payment webhooks, and output escaping were retained.
- The dependency audit reports zero known vulnerabilities in the locked dependency graph.
- Git history secret-pattern scanning reports no discovered committed credential pattern.

The application still relies on application-layer role and tenant checks across a large route surface. Independent penetration testing and code review remain recommended before processing sensitive school data at scale.

## Backup and restore strategy

PostgreSQL metadata and R2 bytes form one recovery set. Writes should be paused, a common timestamp and application SHA recorded, PostgreSQL backed up, and the R2 `schools/` inventory/objects copied or versioned. Restore PostgreSQL first and R2 second while writes remain paused, then run authenticated integrity checks before reopening writes. A database-only or bucket-only restore is incomplete.

The complete procedure is documented in `docs/production-storage.md`.

**BLOCKED:** no production backup target or coordinated restore rehearsal was available in this environment.

## Tests executed from the final local code state

- `npm test`: passed all 20 scripted regression stages, including route connections, authentication migration, tenant isolation, security, replica restore, one-time owner reset, storage lifecycle, imports, cinematic navigation, web quality, adversarial entry points, authorization matrix, Render metadata, finance, preferences, and legal notices.
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

CI status: **BLOCKED/PENDING** until the branch is pushed and the pull request workflow completes.

## Manual and external validation still required

1. Create and configure production Cloudflare R2, then execute the live storage lifecycle and integrity checks.
2. Inspect production PostgreSQL, verify indexes/query behavior, and perform a coordinated database + R2 restore rehearsal.
3. Verify production email, SMS, Google/Yahoo/Microsoft sign-in, payment destination, and signed payment webhook with real provider test accounts.
4. Test representative physical Android, iOS, tablet, desktop, and accessibility-assistive devices.
5. Run independent security review/penetration testing and confirm POPIA operational procedures with the responsible organization.
6. Observe the final Render deployment and production health/readiness endpoints after merge. A successful local build or prior deployment is not deployment verification for this branch.

## Configuration required before launch

At minimum: `NODE_ENV`, `DATABASE_URL`, `SESSION_SECRET`, `LF_FIELD_ENCRYPTION_KEY`, the four `CLOUDFLARE_R2_*` variables, a production administrator, approved payment destination, `LF_PAYMENT_WEBHOOK_SECRET`, monitoring, and a tested offsite backup target. Optional providers additionally require their documented email, SMS, and OAuth secrets.

For the requested account cutover, Render must temporarily receive `LF_OWNER_RESET_ALL_ACCOUNTS=1`, a unique `LF_OWNER_ACCOUNT_RESET_ID`, and the owner name, username, and password variables documented in `.env.example`. After the deployment is verified and only the owner account remains, disable the reset flag and remove the password variable. The migration record remains in the primary database to prevent accidental replay.

