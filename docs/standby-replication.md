# Standby, shared-database failover, and snapshot recovery

Little Feet supports two distinct standby modes. `npm run start:backup` is a read-only recovery viewer hydrated from encrypted Cloudflare R2 snapshots. For automatic writable web-service failover, deploy the normal `node server.js` application as a second Render service and configure `LF_REPLICA_MODE=1`, `LF_SHARED_DATABASE_FAILOVER=1`, and the same production `DATABASE_URL`. Both web processes then use the same PostgreSQL database as the sole source of truth. Existing PostgreSQL advisory lock `12801337` serializes application mutations; the standby reloads current state under that lock before each mutation and refreshes its read cache every three seconds. It does not promote or copy a second database, so database failover remains a separate availability requirement.

## Render configuration

Configure the primary Render web service with:

- `DATABASE_URL` pointing to the primary PostgreSQL database;
- `CLOUDFLARE_R2_ACCOUNT_ID` and the ordinary production-bucket variables;
- `LF_BACKUP_R2_BUCKET` set to the private recovery bucket (different from `CLOUDFLARE_R2_BUCKET`);
- `LF_BACKUP_R2_ACCESS_KEY_ID` and `LF_BACKUP_R2_SECRET_ACCESS_KEY` using a token scoped to that recovery bucket with Object Read & Write;
- `LF_BACKUP_ENCRYPTION_KEY` of at least 32 characters, stored as a protected Render secret;
- `LITTLE_FEET_BACKUP_URL` set to the standby's public HTTPS origin.

Create a separate Render web service from the same repository and `main` branch, then enable auto-deploy only after required CI checks pass. For writable service failover, use start command `node server.js` and configure `LF_REPLICA_MODE=1`, `LF_SHARED_DATABASE_FAILOVER=1`, the exact same `DATABASE_URL`, `SESSION_SECRET`, and `LF_FIELD_ENCRYPTION_KEY` as the primary, and `LF_ALLOWED_BROWSER_ORIGINS=https://littlefeet.co.za`. Also configure the same production R2 object-storage settings so private attachments remain available. Keep the recovery snapshot writer credentials only on the primary; the shared-database standby does not publish snapshots. Apply an external health-checked active/passive Load Balancer with primary and standby service origins. The primary monitor should check `/api/health`; it returns a failing HTTP status if PostgreSQL is unreachable. The standby monitor should check `/api/failover-readiness`; it returns success only while shared PostgreSQL is reachable. Never store credentials in source control or browser configuration.

If running snapshot-only recovery instead, use `npm run start:backup`, omit `DATABASE_URL`, omit `LF_SHARED_DATABASE_FAILOVER`, and leave business writes disabled. Never mix the two modes.

The primary writes the complete application-state snapshot to `standby/latest.snapshot.enc` after each durable save (debounced by 250 ms) and on startup. It uses AES-256-GCM authenticated encryption. R2 object replacement is atomic; the standby polls every 10 seconds, authenticates and validates the snapshot before applying it, and reports capture time/age in `/api/failover-readiness` and authenticated `/api/health` responses. The primary's browser health monitor checks that endpoint across origins and redirects only when the standby is configured, current within 120 seconds, and not on a different known application SHA. Missing configuration disables remote transport and is explicitly logged; it does not report a remote replica as healthy. A 256 MiB bound is enforced.

## Failover limits and safe operation

The portal health monitor can redirect a browser to `LITTLE_FEET_BACKUP_URL` after consecutive primary health failures. An external load balancer is required to direct all site requests, integrations, and webhooks to a healthy service. In shared-database mode both app instances are writable because all writes go to one PostgreSQL database and use the same advisory lock. In snapshot-only mode, writes are rejected with HTTP 503.

This mode provides automatic web-instance failover, not database promotion. PostgreSQL remains a shared single point of failure; configure a managed PostgreSQL service with its own tested failover/restore plan. Both Render services must remain on the same release. Existing sessions are stored in PostgreSQL and survive app-instance failover when both services share the same session secret. A browser redirect alone does not fail over inbound email/payment webhooks; use the external load balancer for the public hostname.

## Verification

`tests/failover-mode.test.js` verifies safe selection of the shared-database writable mode and refuses it without a database URL. `tests/replica-transport.test.js` verifies authenticated R2 snapshot encryption and corruption/wrong-key rejection. `tests/replica-restore.test.js` verifies snapshot-only reads and write refusal. These tests do not validate two concurrent live PostgreSQL-backed app instances, Render configuration, the external load balancer, live R2 permissions, or public failover. Those require a live isolated rehearsal before activation.
