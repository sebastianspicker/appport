# Relution adapter

The live adapter implements a narrow set of Relution management API operations.
The project compatibility target is Relution 26.4.0. A tenant OpenAPI export is
not included, so each target tenant and Relution upgrade requires separate
qualification.

## API operations

Identity and groups:

```text
POST /api/management/v1/security/users/baseInfo/query
GET  /api/management/v1/security/users/{uuid}/groups
GET  /api/management/v1/security/groups/{uuid}/members
```

Devices, applications, permissions, and inventory:

```text
POST /api/management/v2/devices/baseInfo/query
GET  /api/management/v1/content/apps/baseInfo
GET  /api/management/v1/content/apps/{appUuid}/permissions/RELEASE
GET  /api/management/v1/devices/{deviceUuid}/installedApps
POST /api/management/v2/devices/{deviceUuid}/installedApps/baseInfo/query
```

Deployment and action state:

```text
POST /api/management/v1/content/apps/{appUuid}/versions/{versionUuid}/deployments
GET  /api/management/v1/devices/{deviceUuid}/actions
GET  /api/management/v1/devices/{deviceUuid}/actions/{actionUuid}
```

Group membership requests use recursive filtering. List operations use bounded
pagination.

The service token is sent in `X-User-Access-Token`. The organization UUID is
sent as `tenantOrganizationUuid`.

## Catalog rules

The adapter includes only released applications whose subtype is:

- `WINGET`;
- `WINDOWS_MSI`;
- `WINDOWS_EXE`.

It evaluates direct user permissions and recursive group membership for the
`RELEASE` operation. The configured `APPPORT_NATIVE_APP_UUID`, when present,
is excluded.

An update is available only when inventory contains:

- the matching application UUID;
- a non-null installed version UUID;
- an installed version different from the released version;
- `hasUpdateAvailable=true`.

Ambiguous application or inventory identity fails closed.

## Transport behavior

- The Relution origin is fixed and must use HTTPS.
- Redirects are rejected.
- JSON responses are limited to 10 MiB.
- Icons are limited to 1 MiB and must be PNG, JPEG, or WebP.
- Pagination stops at the configured page and count limits.
- Read operations retry `429`, `502`, `503`, `504`, and transient network
  failures at most twice with bounded delay.
- Deployment requests are never retried automatically.
- Malformed wrappers, arrays, identifiers, or totals fail closed.
- Authentication, authorization, unavailable, invalid-response, and deployment
  failures map to stable broker error codes.

A result becomes `unknown` when dispatch started but acceptance or correlation
cannot be proved.

## Required service permissions

Use a dedicated service token limited to:

- reading users and groups in the configured organization;
- reading assigned devices and installed inventory;
- reading application metadata and release permissions;
- reading device deployment actions;
- creating deployments for approved Windows application versions.

Do not grant wipe, withdraw, shell, PowerShell, arbitrary package request,
application removal, user management, policy mutation, or cross-organization
access.

## Tenant qualification

Before enabling live writes for a tenant or after upgrading Relution, verify:

- username lookup and case handling;
- organization scoping;
- direct and nested group membership;
- user and group release permissions;
- denied permission behavior;
- assigned, shared, and loaned device behavior;
- released Winget, MSI, and EXE data;
- installed application and version UUIDs;
- update-availability behavior;
- deployment response wrappers;
- action details and action types used for correlation;
- inventory lag after execution.

Use a sanitized tenant contract and fixtures when updating decoders. Do not
weaken decoding or authorization for an unexplained response.
