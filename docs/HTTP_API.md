# HTTP API

The broker exposes a browser sign-in surface, health endpoints, and a native
API. There is no browser catalog.

## Authentication

Browser routes use the mock development cookie or Better Auth OIDC session
cookies.

Native resource routes require:

```text
Authorization: Bearer <native-token>
```

The token is a 32-byte random value encoded as 43 base64url characters. The
broker stores its SHA-256 hash. Native routes derive both user and device from
the session and recheck the current Relution assignment.

Successful native JSON responses use `Cache-Control: no-store` except for
authenticated icons, which use a private five-minute cache.

## Browser and service routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Broker landing page |
| `GET` | `/sign-in` | Validated native handoff sign-in page |
| `GET` | `/native/connect` | Create or continue a verifier-bound browser handoff |
| `POST` | `/api/auth/mock/sign-in` | Mock-mode sign-in with same-origin validation |
| `GET`, `POST` | `/api/auth/*` | Better Auth handlers |
| `GET` | `/api/health` | Process health |
| `GET` | `/api/ready` | Configured gateway readiness; live mode checks configuration and SQLite |

`/sign-in` redirects to `/` when its `returnTo` value is not a valid native
connect path. The mock sign-in route returns `404` outside mock mode.

## Native routes

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/native/session/exchange` | Consume a one-time browser code and create a native session |
| `DELETE` | `/api/native/session` | Revoke the current native session |
| `GET` | `/api/native/bootstrap` | Read the user, device, session expiry, and update count |
| `GET` | `/api/native/apps` | Read the approved catalog |
| `GET` | `/api/native/updates` | Read approved updates and active update actions |
| `GET` | `/api/native/installed` | Read installed software inventory |
| `GET` | `/api/native/apps/{appId}/icon` | Read an authorized application icon |
| `POST` | `/api/native/apps/{appId}/actions` | Request an install or update |
| `GET` | `/api/native/actions/{actionId}` | Refresh one owned action |

## Session exchange

The exchange request is limited to 8 KiB and uses the shared
`NativeSessionExchangeRequest` contract:

```json
{
  "requestId": "47c4b74e-98dd-4fe1-8736-ea60929c1c11",
  "code": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "verifier": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "clientVersion": "0.1.0-alpha.1",
  "locale": "en-US",
  "deviceEvidence": {
    "version": 1,
    "entDmid": "managed-device-id",
    "smbiosUuid": "system-uuid",
    "biosSerial": "serial-number",
    "hostname": "OFFICE-LAPTOP"
  }
}
```

Optional evidence fields may be omitted. The hostname is required. A
successful exchange returns `201` with the bearer token, expiry, and selected
device. Invalid, expired, reused, conflicting, or ambiguous handoffs fail.

## Bootstrap and list responses

Bootstrap returns:

```json
{
  "user": {
    "displayName": "Alex Morgan"
  },
  "device": {
    "name": "Office Laptop",
    "status": "COMPLIANT",
    "lastSeenAt": "2026-07-24T08:00:00.000Z"
  },
  "sessionExpiresAt": "2026-07-24T16:00:00.000Z",
  "updateCount": 3
}
```

Catalog and update routes return an `applications` array. Each application has
these fields:

| Field | Type |
| --- | --- |
| `id`, `name`, `releasedVersionId` | string |
| `description`, `publisher`, `packageIdentifier` | string or `null` |
| `source` | `winget`, `windows_msi`, or `windows_exe` |
| `releasedVersionLabel`, `installedVersionId`, `installedVersionLabel` | string or `null` |
| `installState` | `not_installed`, `installed`, `update_available`, or `action_active` |
| `activeActionId` | string or `null` |
| `activeActionState` | action state or `null` |
| `iconUrl` | string or `null` |

The installed route returns an `applications` array with:

| Field | Type |
| --- | --- |
| `appId`, `versionId`, `source`, `iconUrl` | string or `null` |
| `packageId`, `name`, `version` | string |
| `updateAvailable`, `approved` | boolean |

Action responses use `id`, `deviceId`, `appId`, `intent`, `state`,
`errorCode`, `errorMessage`, `createdAt`, and `updatedAt`. Nullable fields are
`errorCode` and `errorMessage`; `intent` is `install` or `update`.

## Action requests

Action creation accepts a JSON body no larger than 1 KiB:

```json
{
  "idempotencyKey": "7be8b295-5087-42b9-bfb2-68de9e86baf7"
}
```

The idempotency key must be a UUID. A new action returns `202`. An identical
existing reservation returns `200`. Reusing the key for a different request or
requesting a second active action for the same device and application returns
a conflict.

Possible action states are `queued`, `sent`, `deferred`, `verifying`,
`succeeded`, `failed`, `cancelled`, and `unknown`.

## Icons

Icon responses require the same native session and assignment checks as other
resources. The live adapter accepts PNG, JPEG, or WebP source data up to 1 MiB.
The Windows client applies its own 512 KiB response limit.

## Rate limits

Native connect and exchange each use:

- 10 requests per minute per derived client key;
- 100 requests per minute globally.

The limits are process-local. `APPPORT_TRUST_PROXY=true` uses a valid
proxy-supplied `X-Real-IP` value as the client key. Without it, all callers use
one unidentified-client key.

Action creation also enforces eight new reservations per owner in a rolling
minute. An identical idempotent replay does not consume another reservation.

## Error format

JSON errors use a stable code and request identifier:

```json
{
  "error": {
    "code": "SESSION_EXPIRED",
    "message": "The native session has expired.",
    "requestId": "31a1c556-5275-40ec-a8f6-fdb63ac42410"
  }
}
```

Error responses include `Cache-Control: no-store` and `X-Request-Id`. Clients
must branch on `code`, not on the human-readable message.

Defined error codes:

```text
BAD_REQUEST
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
CONFLICT
RATE_LIMITED
SESSION_EXPIRED
DEVICE_MATCH_FAILED
INTEGRATION_AUTHENTICATION
INTEGRATION_AUTHORIZATION
INTEGRATION_UNAVAILABLE
INVALID_RESPONSE
INVALID_DEPLOYMENT
LIVE_WRITES_DISABLED
INTERNAL_ERROR
```
