# Configuration

Appport's native configuration is fixed when Rust compiles the desktop client and
qualification utility. Users cannot change the Relution endpoint, organization, or
qualification profile at runtime. Rebuild the binaries to change any of these
settings.

## Build settings

| Variable | Value |
| --- | --- |
| `APPPORT_RELUTION_API_BASE_URL` | HTTPS origin of the Relution API. Credentials, paths, queries, and fragments are rejected. |
| `APPPORT_RELUTION_ORGANIZATION_UUID` | UUID of the Relution organization used by this build. |
| `APPPORT_NATIVE_APP_UUID` | UUID of the Appport application in Relution. Appport removes this application from its own catalog. It must differ from the organization UUID. |
| `APPPORT_QUALIFICATION_PROFILE` | `read_only` or `write_qualification`. |
| `APPPORT_RELUTION_WRITES_ENABLED` | `false` for `read_only`; `true` for `write_qualification`. Any other pairing fails the build. |
| `APPPORT_RELUTION_DIAGNOSTICS` | Exactly `true` or `false`. Candidate builds use `false`. |
| `APPPORT_QUALIFICATION_TENANT_APPROVED` | Exactly `true` for a release build. |
| `APPPORT_RELUTION_TENANT_CLASS` | Exactly `qualification` for a release build. |
| `APPPORT_DISPOSABLE_RESOURCES_APPROVED` | Exactly `true` for `write_qualification`. |
| `APPPORT_SOURCE_REVISION` | The exact 40-character hexadecimal commit ID built into the candidate and its reports. |
| `APPPORT_SOURCE_VERIFICATION` | Repository source-check mode. The verification script sets this to `true` and supplies non-routable test values. |

The build script calculates `APPPORT_CONFIGURATION_FINGERPRINT_SHA256` from the
effective settings and sets `APPPORT_QUALIFICATION_BUILD`. These two values are
generated and should not be supplied manually.

Release builds fail when required values are missing or inconsistent. Validation
also rejects placeholder hosts, nil and repeated-placeholder UUIDs, a source-check
configuration used for a release build, or any tenant classification other than the
values above.

The write profile needs a JSON plan that matches
[`qualification-plan.schema.json`](qualification-plan.schema.json). Pass the plan to
the qualification utility at runtime. It contains identifiers for disposable test
resources, expected versions, and cleanup responsibility. Keep this tenant-specific
file out of the repository and generated release records.

## Personal tokens

The desktop client accepts a personal token through its masked sign-in field. The
qualification utility reads tokens from masked console input. Appport does not read
tokens from command-line arguments, environment variables, configuration files, or
build settings, and it never writes them to logs or reports.

Personal tokens are the only supported authentication method. Basic authentication,
portal cookies, HTML login, client secrets, private keys, and administrative
credentials are unsupported.

## Diagnostic logging

Set `APPPORT_RELUTION_DIAGNOSTICS=true` only for troubleshooting. The setting changes
the configuration fingerprint, and a diagnostic build cannot pass candidate checks.

On Windows, diagnostic builds write sanitized Relution response records to:

```text
%LOCALAPPDATA%\Relution\Appport\relution-debug.log
%LOCALAPPDATA%\Relution\Appport\relution-debug.log.1
```

Each record contains the HTTP method, API path, response status, and a sanitized
response body. Request data, request and response headers, query values, malformed
or binary bodies, and identifying JSON values are omitted. A body is limited to
8 KiB. Each log file is limited to 256 KiB.

Native debug builds also write these records to stderr with the
`APPPORT_RELUTION_DIAGNOSTIC` prefix. Terminal, IDE, and CI output can therefore
contain tenant troubleshooting data. Logs expire on the first diagnostic write
after seven days. Remove the files and captured output when the investigation is
finished, unless they must be retained for an incident.

See [Development](DEVELOPMENT.md) for a read-only Windows development example and
[Operations](OPERATIONS.md) for candidate build instructions.
