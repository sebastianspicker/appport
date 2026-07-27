# Operations

## Broker deployment

The repository provides a Dockerfile for one standalone Next.js broker. It does
not provide Compose, Kubernetes, reverse-proxy, or secret-manager manifests.

Deploy the broker with:

1. one replica;
2. a durable volume mounted at `/data`;
3. a trusted HTTPS reverse proxy;
4. read-only authentication, OIDC, and Relution secret files;
5. the production variables in [CONFIGURATION.md](CONFIGURATION.md);
6. `APPPORT_LIVE_WRITES_ENABLED=false` for initial qualification.

The image runs as UID and GID 1001, exposes port `3000`, and uses
`/api/ready` for its container health check. Application files are read-only.
Only `/data` is writable.

Confirm both endpoints after startup:

```text
GET /api/health
GET /api/ready
```

`/api/health` confirms that the process responds. In live mode, `/api/ready`
confirms that configuration and SQLite initialization succeed. Mock mode does
not exercise SQLite readiness.

Successful responses are:

```json
{"status":"ok","service":"relution-appport"}
```

```json
{"status":"ready","service":"relution-appport"}
```

Readiness failure returns HTTP `503` with:

```json
{"status":"not_ready","service":"relution-appport"}
```

Register this exact OIDC redirect URI with the identity provider:

```text
https://apps.example.edu/api/auth/callback/relution-oidc
```

Replace the example origin with `APP_BASE_URL`. The path comes from the
configured Better Auth base path and the `relution-oidc` provider identifier.

The repository does not define a container registry, deployment platform,
reverse-proxy product, or secret manager. Image publication, volume
provisioning for UID 1001, proxy configuration, secret mounts, and platform log
collection must be supplied and verified by the deployment owner.

The deployment must satisfy [RUNTIME_CONTRACT.md](RUNTIME_CONTRACT.md).

## Read-only qualification

Before enabling deployment requests, compare Appport with the Relution
administrator view using dedicated lab identities and devices:

- OIDC username resolution;
- assigned Windows device selection;
- direct and nested group permissions;
- approved Winget, MSI, and EXE applications;
- installed inventory and released version UUIDs;
- update availability;
- denied permission behavior.

Keep live writes disabled until each read-only result is understood.

## Live-write canaries

Enable live writes only for an approved canary window:

```text
APPPORT_LIVE_WRITES_ENABLED=true
```

Use separate test applications and devices for:

- one Winget update;
- one MSI deployment;
- one EXE deployment;
- offline-device deferral;
- controlled installer failure and explicit retry;
- lost response;
- process restart during action correlation;
- delayed installed-inventory reporting.

Do not use wipe, withdraw, application removal, shell, or PowerShell operations
as negative tests. Disable live writes again when the canary window closes.

## Windows client deployment

1. Build the MSI on the approved Windows 11 x64 host with the production broker
   origin embedded.
2. Authenticode-sign and timestamp the executable and MSI.
3. Create a Relution `WINDOWS_MSI` application.
4. Configure silent, no-restart, per-machine installation under SYSTEM.
5. Assign it only to the named pilot group.
6. Enable automatic Appport updates in Relution.
7. Set `APPPORT_NATIVE_APP_UUID` on the broker.

Complete the Windows checks in
[NATIVE_WINDOWS_CLIENT.md](NATIVE_WINDOWS_CLIENT.md) before promotion.

## Unknown action reconciliation

An `unknown` action may already have reached Relution. Do not submit it again.

1. Copy the Appport action ID.
2. Locate the protected action and audit records in SQLite.
3. Compare the device, application, target version, dispatch time, and
   correlated Relution action.
4. Refresh the action in the Windows client.
5. The broker changes the action to `succeeded` only when installed inventory
   contains the intended version UUID.
6. If inventory cannot prove success, retain `unknown`.

There is no supported manual database transition or automatic retry. Retention
cleanup does not remove `unknown` actions.

## Native-session revocation

The revocation utility requires an absolute SQLite path. It performs a dry run
unless `--apply` is present.

Review all active sessions:

```sh
pnpm revoke-native-sessions -- \
  --database /data/appport.sqlite \
  --scope all
```

The dry run exits with status `2` when matching sessions exist and `0` when
none exist. Apply the same scope after review:

```sh
pnpm revoke-native-sessions -- \
  --database /data/appport.sqlite \
  --scope all \
  --apply
```

User scope requires the OIDC issuer and subject:

```sh
pnpm revoke-native-sessions -- \
  --database /data/appport.sqlite \
  --scope user \
  --issuer https://identity.example.edu \
  --subject subject-value
```

Device scope requires the Relution device UUID:

```sh
pnpm revoke-native-sessions -- \
  --database /data/appport.sqlite \
  --scope device \
  --device relution-device-uuid
```

Add `--apply` only after reviewing the dry-run count. Affected native clients
must sign in again.

The command does not revoke Better Auth browser sessions. Browser-session
revocation depends on the identity provider and Better Auth deployment.

## Backup and restore

- Snapshot `/data` daily.
- Encrypt backups and restrict access.
- Retain seven daily snapshots.
- Test restoration at least quarterly.
- Disable live writes before restore or broker rollback.
- Preserve active and `unknown` action evidence.
- Restore SQLite only for confirmed database damage.

The repository does not contain backup automation. The deployment owner must
implement and test it.

## Secret rotation

Rotate one credential at a time:

1. replace the mounted secret file;
2. restart the broker when the runtime does not reload the file;
3. validate one sign-in or Relution read;
4. revoke the old credential at its issuer.

Rotating `AUTH_SECRET_FILE` invalidates browser session cookies. It does not
automatically revoke native bearer sessions stored in SQLite. Use the
revocation utility when the incident scope requires native sign-in again.

Rotating the OIDC client secret affects new browser authentication. Rotating
the Relution service token affects live adapter requests. Existing native
sessions remain subject to their eight-hour expiry and assignment checks.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `/api/health` fails | Container process, port, and platform logs |
| `/api/ready` returns `503` | Required variables, secret file type and mode, absolute SQLite path, and writable `/data` |
| OIDC redirect fails | `APP_BASE_URL`, `APPPORT_PUBLIC_ORIGIN`, issuer URL, registered callback, and proxy scheme |
| Mock broker requests live configuration | Set `RELUTION_GATEWAY_MODE=mock` explicitly |
| All callers share a native sign-in limit | Trusted proxy topology and `APPPORT_TRUST_PROXY` |
| Native sign-in cannot return to the client | Fixed HTTPS origin, certificate trust, loopback access, proxy reachability, and system clock |
| Device matching fails | Current assignment, EntDMID, SMBIOS UUID, serial, hostname, and duplicate Relution devices |
| Install returns `LIVE_WRITES_DISABLED` | Complete qualification before setting `APPPORT_LIVE_WRITES_ENABLED=true` |
| Action remains `unknown` | Relution action record and installed inventory; do not resubmit |
| Sign-out reports partial cleanup | Remote revocation, Credential Manager deletion, and scheduled-task removal |
| MSI downgrade fails | Use an approved replacement version or tested uninstall and reinstall path |

Treat logs and databases as sensitive operational data. Do not attach
production copies to public issues.
