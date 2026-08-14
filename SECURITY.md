# Security policy

Appport is a Windows client. It does not ship web routes, a network service, or Relution technical-account credentials. Its per-user SQLite journal contains action recovery metadata and never stores the access token.

## Security boundary

- The endpoint is a fixed HTTPS origin embedded at build time. There is no runtime endpoint override.
- The WebView has no network permission. Rust owns outbound requests.
- Windows Credential Manager stores a versioned record containing the personal token, validated username, and immutable Relution user UUID.
- The per-user action journal applies a current-user Windows ACL to its directory, database, and SQLite sidecars.
- The client sends device evidence only to the configured Relution API.
- Alpha.4 embeds one exact qualification profile and matching write flag; it has no runtime write override. Write qualification also requires explicit qualification-tenant and disposable-resource approvals.

Relution remains responsible for user authentication, authorization, audit retention, and deployment mutations. Do not add administrative tokens to this repository.

## Reporting

Report a vulnerability privately to the maintainer. Include affected version, reproduction steps, impact, and any mitigation already applied. Do not include credentials, bearer tokens, device identifiers, or customer data.

## Supported version

Only the current qualification alpha version, 0.1.0-alpha.4, receives security fixes. It is unsigned, tenant-fixed, non-distributable, and must not target production.
