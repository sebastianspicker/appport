# Security policy

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue. Use the private
security reporting channel configured by the repository owner. If GitHub
private vulnerability reporting is enabled, use the Security tab.

The repository does not publish a dedicated security contact. One must be
defined before the managed pilot expands.

## Sensitive material

Do not submit:

- authentication secrets or OIDC client secrets;
- Relution service tokens;
- signing certificates or private keys;
- tenant exports or organization identifiers;
- user data or device evidence;
- production SQLite databases or backups;
- production logs.

Production secrets are read from mounted files and must not be stored in the
repository. Treat the SQLite database and native bearer tokens as sensitive
operational data.

## Security boundaries

- The Windows WebView cannot access the network.
- Rust code owns all broker communication.
- The Windows client contains no Relution service token or OIDC client secret.
- The broker stores hashes of native bearer tokens and device evidence.
- Every native resource request rechecks device assignment.
- Deployment requests require current authorization, inventory checks, an
  idempotency key, and the live-write switch.
- Production secret files must be regular files without group or other
  permissions.

The native bearer is portable, and initial user resolution depends on a
username claim before the immutable Relution UUID is pinned. These constraints
limit the current release to a restricted managed pilot. See
[docs/RUNTIME_CONTRACT.md](docs/RUNTIME_CONTRACT.md).

## Supported version

The current source version is `0.1.0-alpha.1`. Its verified and unverified
release gates are listed in [RELEASE_STATUS.md](RELEASE_STATUS.md).
