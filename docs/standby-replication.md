# Read-only standby replication

Little Feet can publish encrypted application-state snapshots from the primary service to the private Cloudflare R2 recovery bucket. A separately deployed service started with `npm run start:backup` reads those snapshots and remains read-only. The standby reads shared private files from the production R2 bucket using its ordinary server-side storage credentials.

## Render configuration

Configure the primary Render web service with:

- `DATABASE_URL` pointing to the primary PostgreSQL database;
- `CLOUDFLARE_R2_ACCOUNT_ID` and the ordinary production-bucket variables;
- `LF_BACKUP_R2_BUCKET` set to the private recovery bucket (different from `CLOUDFLARE_R2_BUCKET`);
- `LF_BACKUP_R2_ACCESS_KEY_ID` and `LF_BACKUP_R2_SECRET_ACCESS_KEY` using a token scoped to that recovery bucket with Object Read & Write;
- `LF_BACKUP_ENCRYPTION_KEY` of at least 32 characters, stored as a protected Render secret;
- `LITTLE_FEET_BACKUP_URL` set to the standby's public HTTPS origin.

Create a separate Render web service from the same repository and `main` branch, with automatic deploys enabled, so every new `main` commit deploys to both services. Configure the standby with `LF_REPLICA_MODE=1`, the same `LF_FIELD_ENCRYPTION_KEY` for encrypted Little Feet fields, production-bucket read credentials for private attachments, the same `LF_BACKUP_R2_BUCKET`, recovery-bucket read access, and the same `LF_BACKUP_ENCRYPTION_KEY`. Use a separately scoped R2 credential if the hosting configuration permits it. Never put credentials in client configuration. Ensure the standby service uses the read-only start command and does not receive `DATABASE_URL` for the primary database.

The primary writes the complete application-state snapshot to `standby/latest.snapshot.enc` after each durable save (debounced by 250 ms) and on startup. It uses AES-256-GCM authenticated encryption. R2 object replacement is atomic; the standby polls every 10 seconds, authenticates and validates the snapshot before applying it, and reports capture time/age in `/api/failover-readiness` and authenticated `/api/health` responses. The primary's browser health monitor checks that endpoint across origins and redirects only when the standby is configured, current within 120 seconds, and not on a different known application SHA. Missing configuration disables remote transport and is explicitly logged; it does not report a remote replica as healthy. A 256 MiB bound is enforced.

## Failover limits and safe operation

The portal health monitor can redirect a browser to `LITTLE_FEET_BACKUP_URL` after consecutive primary health failures. The standby permits login and reads but rejects all business-data writes with HTTP 503. It does not automatically become the writer. This prevents two live services from accepting conflicting changes while the primary might still be operating.

This is not a server-side load balancer, DNS failover, or automatic writable promotion. Those require independently managed traffic routing and a tested fencing/lease mechanism that proves the primary cannot accept writes before standby promotion. Do not enable writes on the standby or route API integrations there until that mechanism exists and has been rehearsed. Existing sessions do not move to the standby; users authenticate again after browser redirect.

## Verification

`tests/replica-transport.test.js` verifies configuration failures, authenticated encryption, publish/load between independent transport instances, updates, invalid state, wrong-key rejection, and corruption detection using an isolated in-memory storage adapter. `tests/replica-restore.test.js` verifies the read-only HTTP standby, failover readiness refusal when remote replication is absent, runtime routing behavior, and local snapshot restore path. These tests do not prove that Render environment variables, live R2 permissions, the deployed standby service, or the public failover URL are configured. A live production canary and standby health check are required after service configuration.
