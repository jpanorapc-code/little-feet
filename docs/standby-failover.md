# Production read-only failover

Little Feet supports a separate read-only standby service for emergency access when
the primary web service is unavailable. The standby is intentionally **not** a
second writable primary. This prevents split-brain writes and keeps one durable
source of truth.

## Architecture

Primary service:

1. Persists normal application mutations to PostgreSQL.
2. Writes the existing local `littlefeet-replica.json` cache.
3. When `LF_STANDBY_SYNC_ENABLED=1`, publishes an encrypted, versioned standby
   snapshot to the separate backup R2 bucket.
4. Publishes the small `standby/latest.json` manifest only after the encrypted
   snapshot object has been written successfully.
5. Keeps the most recent snapshot set and periodically prunes older versions.

Standby service:

1. Starts with `npm run start:backup`, which sets `LF_REPLICA_MODE=1`.
2. Loads the last local replica cache if one exists.
3. Polls the backup R2 bucket for the latest manifest.
4. Verifies the encrypted object's SHA-256 hash, decrypts it with
   `LF_BACKUP_ENCRYPTION_KEY`, validates the payload format, then applies it.
5. Stores the verified remote state into the local replica cache for restart
   resilience.
6. Rejects business-data mutations with HTTP 503 and `Retry-After: 30`.

The primary browser health monitor probes `/api/health` every 30 seconds while
the page is visible. Two consecutive failed probes redirect to
`LF_BACKUP_PUBLIC_URL`. The standby never receives a backup redirect URL, so it
cannot create a redirect loop.

Failback is deliberately manual. The standby banner exposes **Try primary
service**, which uses `LF_PRIMARY_PUBLIC_URL`. This avoids bouncing users back
to a primary service that may only be briefly healthy.

## Required primary environment

Keep the existing production variables and add:

```
LF_STANDBY_SYNC_ENABLED=1
LF_BACKUP_R2_BUCKET=<separate backup bucket>
LF_BACKUP_R2_ACCESS_KEY_ID=<backup-bucket credential>
LF_BACKUP_R2_SECRET_ACCESS_KEY=<backup-bucket credential>
LF_BACKUP_ENCRYPTION_KEY=<random secret, minimum 32 characters>
LF_BACKUP_PUBLIC_URL=https://<standby-host>
```

The primary may reuse the normal R2 account ID:
`CLOUDFLARE_R2_ACCOUNT_ID`.

Optional tuning:

```
LF_STANDBY_R2_PREFIX=standby
LF_STANDBY_PUBLISH_INTERVAL_MS=30000
LF_STANDBY_MAX_AGE_MS=180000
LF_STANDBY_SNAPSHOT_MAX_BYTES=67108864
LF_STANDBY_SNAPSHOT_RETENTION=120
```

## Required standby environment

Deploy the same Git commit in a separate service and use:

```
NODE_ENV=production
SESSION_SECRET=<same secure session-signing secret policy>
LF_FIELD_ENCRYPTION_KEY=<same field encryption key as primary>
LF_STANDBY_SYNC_ENABLED=1
LF_BACKUP_R2_BUCKET=<same backup bucket>
LF_BACKUP_R2_ACCESS_KEY_ID=<read access to backup bucket>
LF_BACKUP_R2_SECRET_ACCESS_KEY=<matching credential>
LF_BACKUP_ENCRYPTION_KEY=<same standby snapshot encryption key>
LF_PRIMARY_PUBLIC_URL=https://littlefeet.co.za
```

For private file viewing during failover, also configure the normal
`CLOUDFLARE_R2_*` live-object-storage settings on the standby. Do **not** depend
on a standby `DATABASE_URL`; replica mode does not use PostgreSQL as a writable
application store.

Optional:

```
LF_STANDBY_POLL_INTERVAL_MS=5000
LF_STANDBY_MAX_AGE_MS=180000
```

Start command:

```
npm run start:backup
```

## Runtime checks

Public endpoints:

- `/api/health` reports `PRIMARY` or `STANDBY`.
- `/api/ready` reports whether the current instance is safe to receive traffic.
- `/api/keepalive` returns 503 on a standby whose replica is unavailable/stale.
- `/api/failover-status` exposes only non-sensitive failover status and snapshot
  freshness.

On the standby, the UI clearly displays **Emergency read-only mode**. If the
snapshot is older than `LF_STANDBY_MAX_AGE_MS`, the banner changes to a stale
warning and readiness fails.

## Safe rehearsal

Before setting `LF_BACKUP_PUBLIC_URL` on the primary:

1. Deploy the standby separately.
2. Confirm its `/api/health` reports `STANDBY`.
3. Confirm its `/api/ready` is ready with a fresh remote snapshot.
4. Sign in on the standby and verify school/role isolation.
5. Verify learner search, parent contacts, schedules and other required read
   paths.
6. Attempt a harmless write and confirm HTTP 503 with a read-only message.
7. Stop or isolate the primary in a planned maintenance window.
8. Confirm the primary browser redirects after two failed probes.
9. Confirm the standby banner is visible and data freshness is within the
   configured limit.
10. Restore the primary, verify its health/readiness, then use **Try primary
    service** to return manually.

Do not enable writable standby promotion until Little Feet uses a managed
single-writer database failover design with fencing. The current standby is an
emergency visibility layer, not a second writable database.
