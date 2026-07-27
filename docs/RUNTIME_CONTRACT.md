# Runtime contract

These constraints define the supported broker topology for the restricted
managed pilot.

## Container and persistence

- Run exactly one broker process.
- Mount one durable volume at `/data`.
- Set `APPPORT_SQLITE_PATH` to an absolute path under `/data`.
- Grant write access only to `/data`.
- Keep application and secret files read-only.
- Run the container as the `appport` user with UID 1001.

Do not share the SQLite volume between replicas or processes. The repository
does not implement distributed locking or an external database adapter.

## Network edge

- Expose the broker only through HTTPS.
- Use one fixed public origin for the broker, OIDC callback, and Windows
  client.
- Prevent direct public access that bypasses the trusted reverse proxy.
- Remove caller-supplied `X-Forwarded-Proto` and `X-Real-IP` headers.
- Write the trusted forwarding values at the proxy.
- Set `APPPORT_TRUST_PROXY=true` only inside that boundary.
- Reject request bodies larger than 8 KiB at the proxy.

The application separately limits native session exchange bodies to 8 KiB and
action request bodies to 1 KiB.

## Secrets

Supply production secrets through:

```text
AUTH_SECRET_FILE
OIDC_CLIENT_SECRET_FILE
RELUTION_API_TOKEN_FILE
```

Each value must name a regular, nonempty file without group or other
permissions. Mount secret files outside `/data`.

Do not expose literal secret variables, environment files, secret files,
databases, backups, or logs through the image or public diagnostics.

## Live-write control

Start with:

```text
APPPORT_LIVE_WRITES_ENABLED=false
```

Enable writes only during an approved canary or after the deployment is
qualified. Read-only and live-write procedures are in
[OPERATIONS.md](OPERATIONS.md).

## Sessions and identity

- Browser and native sessions expire after eight hours.
- Sessions are not refreshed.
- Native bearer hashes, not bearer values, are stored in SQLite.
- Every native resource request rechecks the assigned Relution device.
- Revoke native sessions during an incident or when reassignment requires an
  immediate sign-in reset.
- Identity-binding schema upgrades revoke earlier native sessions.

The native token is a portable bearer. Initial Relution user resolution uses a
username claim before the immutable Relution UUID is pinned. Restrict the
current release to a named Windows 11 x64 group with one assigned managed
device per user, no shared-device rollout, monitored authentication failures,
and an available revocation procedure.

Before wider deployment, qualify an immutable initial identifier and approve
stronger device-binding or proof-of-possession controls.

## Backup and rollback

- Create encrypted daily snapshots of `/data`.
- Retain seven daily snapshots.
- Test restoration at least quarterly.
- Disable live writes before database restore or broker rollback.
- Preserve active and `unknown` action evidence.
- Restore SQLite only for confirmed database damage.

Broker rollback uses the prior approved image after the write freeze and
persistence-preservation steps.

The MSI blocks version downgrades. Client rollback requires either a signed
replacement accepted as an upgrade or a separately validated uninstall and
reinstall procedure.

## Unsupported deployment shapes

The current implementation does not support:

- multiple broker replicas;
- shared SQLite storage;
- direct public access without the trusted proxy;
- HTTP client origins;
- runtime user selection of the broker origin;
- shared-device pilot rollout;
- automatic retry of uncertain deployments;
- manual mutation of action state in SQLite.
