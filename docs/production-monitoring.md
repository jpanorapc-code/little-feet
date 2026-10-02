# Production monitoring

The `Production monitor` GitHub Actions workflow checks the public health endpoint, readiness endpoint, and database keepalive every five minutes. A non-2xx response, invalid JSON, unhealthy status, database failure, or timeout fails the workflow. GitHub sends failed-workflow notifications according to the repository owner's notification settings.

Run the workflow manually after configuration or deployment changes. A successful manual run validates the complete monitor path from GitHub to the live Render service and production datastore.

Set `LF_MONITORING_PROVIDER=github-actions` on the Render service only after the scheduled workflow exists on the default branch and a manual run has passed. This setting records the operational provider in the administrator readiness view; it does not suppress failed checks.


## Optional standby monitoring

After the separate read-only standby is deployed and verified, add a repository
Actions variable named `LF_STANDBY_URL` containing its HTTPS origin. The same
scheduled workflow then checks the standby `/api/health`, `/api/ready`, and
`/api/keepalive` endpoints. A stale or unavailable replica fails the standby
check instead of silently reporting the emergency service as healthy.

Leave `LF_STANDBY_URL` unset until the standby deployment is complete. The
primary production monitor continues to run normally when no standby URL is
configured.
