# Configuration

The broker reads configuration from environment variables. Production secrets
must be supplied through regular read-only files. Literal secret variables are
accepted only outside production.

## Process and authentication

| Variable | Required when | Behavior |
| --- | --- | --- |
| `NODE_ENV` | Production | Enables production cookie behavior and secret-file permission checks |
| `PORT` | Optional | Next.js listen port; the container defaults to `3000` |
| `HOSTNAME` | Optional | Next.js bind address; the container defaults to `0.0.0.0` |
| `AUTH_MODE` | Outside tests | Exactly `mock` or `oidc` |
| `AUTH_SECRET_FILE` | Production | Regular, nonempty file containing an authentication secret of at least 32 characters |
| `AUTH_SECRET` | Non-production | Literal authentication secret; a local development default is used when omitted |
| `COOKIE_SECURE` | Optional in mock mode | Literal `false` disables the Secure attribute on the mock session cookie; omitted is also valid for local HTTP when `NODE_ENV` is not `production` |

In production, secret files must not grant group or other permissions. Use
`0400` for a read-only mount or `0600` when the deployment mechanism requires
owner write access.

## OIDC

| Variable | Required when | Behavior |
| --- | --- | --- |
| `APP_BASE_URL` | OIDC | Fixed HTTPS root URL used by Better Auth |
| `OIDC_ISSUER` | OIDC | Fixed HTTPS issuer URL |
| `OIDC_CLIENT_ID` | OIDC | Client identifier |
| `OIDC_CLIENT_SECRET_FILE` | OIDC in production | Regular, nonempty client-secret file |
| `OIDC_CLIENT_SECRET` | OIDC outside production | Literal development client secret |
| `OIDC_USERNAME_CLAIM` | Optional | Username claim; defaults to `preferred_username` |

The issuer and application base URL reject credentials, query strings, and
fragments. `APP_BASE_URL` must use the URL root path. Sign-in fails when the
configured username claim is absent or blank.

Browser sessions expire after eight hours and are not refreshed.

## Relution and persistence

| Variable | Required when | Behavior |
| --- | --- | --- |
| `RELUTION_GATEWAY_MODE` | Optional | `mock` by default or `live`; live mode requires OIDC |
| `RELUTION_API_BASE_URL` | Live | Fixed HTTPS root URL for the Relution management API |
| `RELUTION_ORGANIZATION_UUID` | Live | Organization UUID sent as `tenantOrganizationUuid` |
| `RELUTION_API_TOKEN_FILE` | Live | Regular service-token file; there is no literal-token alternative; production rejects group or other permission bits |
| `APPPORT_PUBLIC_ORIGIN` | Live unless `APP_BASE_URL` is used | Fixed HTTPS root origin for native redirects and mutation-origin checks |
| `APPPORT_SQLITE_PATH` | Live and production | Absolute SQLite path; the container defaults to `/data/appport.sqlite` |
| `APPPORT_LIVE_WRITES_ENABLED` | Optional | Deployment requests run only when the value equals `true`, ignoring case |
| `APPPORT_NATIVE_APP_UUID` | Client distributed through Relution | Relution application UUID omitted from the catalog; maximum 128 characters |
| `APPPORT_TRUST_PROXY` | Trusted proxy supplies client addresses | Literal `true` trusts a syntactically valid `X-Real-IP` value for native rate limits |

`APPPORT_TRUST_PROXY=true` is safe only when the broker is reachable
exclusively through a proxy that removes caller-supplied forwarding headers
and writes its own values.

In non-production mock mode, the broker uses a temporary SQLite file when
`APPPORT_SQLITE_PATH` is not set. Set `RELUTION_GATEWAY_MODE=mock` explicitly
for this behavior.

## Relution tuning

| Variable | Default | Allowed range |
| --- | ---: | ---: |
| `APPPORT_READ_TIMEOUT_MS` | `15000` | 1000 to 60000 |
| `APPPORT_PAGE_SIZE` | `100` | 1 to 500 |
| `APPPORT_MAX_PAGES` | `100` | 1 to 1000 |
| `APPPORT_CACHE_TTL_SECONDS` | `60` | 0 to 3600 |
| `APPPORT_ACTION_CORRELATION_SECONDS` | `120` | 10 to 600 |
| `APPPORT_ACTION_VERIFY_SECONDS` | `300` | 30 to 1800 |
| `APPPORT_AUDIT_RETENTION_DAYS` | `90` | 1 to 3650 |

Invalid integer values stop live configuration from loading.

## Windows client endpoint

| Variable | Scope | Behavior |
| --- | --- | --- |
| `APPPORT_BROKER_URL` | Release build | Broker origin embedded at compile time |
| `RELUTION_BROKER_URL` | Debug build | Runtime override accepted only in debug builds |

Both values must be fixed HTTPS root URLs without credentials, query strings,
or fragments. The release build fails at runtime when
`APPPORT_BROKER_URL` was not embedded.

## Production profile

The container already sets `NODE_ENV=production`, `PORT=3000`,
`HOSTNAME=0.0.0.0`, and `APPPORT_SQLITE_PATH=/data/appport.sqlite`. A live
deployment supplies the remaining non-secret values:

```text
AUTH_MODE=oidc
APP_BASE_URL=https://apps.example.edu
APPPORT_PUBLIC_ORIGIN=https://apps.example.edu
OIDC_ISSUER=https://identity.example.edu
OIDC_CLIENT_ID=appport
RELUTION_GATEWAY_MODE=live
RELUTION_API_BASE_URL=https://relution.example.edu
RELUTION_ORGANIZATION_UUID=organization-uuid
APPPORT_LIVE_WRITES_ENABLED=false
APPPORT_NATIVE_APP_UUID=appport-relution-uuid
APPPORT_TRUST_PROXY=true
```

`APPPORT_NATIVE_APP_UUID` is required for the documented Relution client
distribution so Appport does not list itself. Set `APPPORT_TRUST_PROXY=true`
only for the trusted proxy topology described above. Otherwise omit it or set
it to `false`.

Mount three separate read-only files and set:

```text
AUTH_SECRET_FILE=/run/secrets/appport-auth
OIDC_CLIENT_SECRET_FILE=/run/secrets/appport-oidc
RELUTION_API_TOKEN_FILE=/run/secrets/appport-relution
```

Keep live writes disabled until the read-only qualification and live canaries
in [OPERATIONS.md](OPERATIONS.md) are complete.
