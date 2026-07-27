# Contributing

## Before making a change

1. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
2. Read the reference document for the component being changed.
3. Preserve Relution as the authority for users, groups, devices,
   entitlements, inventory, released versions, and deployment execution.
4. Do not add a production dependency without an explicit project decision.
5. Do not add credentials, tenant exports, user or device data, production
   databases, backups, logs, signing material, or build, test, or evidence
   output.

## Development process

Install the pinned workspace:

```sh
corepack enable
pnpm install --frozen-lockfile
```

Make the smallest change that satisfies the intended behavior. Follow the
existing component boundaries and shared contracts. Add or update tests when a
behavior, validation rule, state transition, or failure path changes.

Test placement:

- broker tests beside the TypeScript module under `src`;
- client interface tests under `apps/windows-client/src`;
- Rust tests in the module they cover.

Run focused checks while developing and `pnpm verify` before requesting review.
The complete command list and platform boundaries are in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentation changes

Documentation must describe the current implementation. Update commands,
paths, environment variables, route tables, and operational constraints in the
same change that modifies them.

Use the established terminology:

- broker for the Next.js service;
- Windows client for the Tauri application;
- Relution Windows Agent for the external deployment executor;
- native session for the broker-issued bearer session.

Do not present mock-adapter results as evidence for a signed Windows package,
the production container, live Relution, or a managed pilot.

## Review information

A review request should state:

- the behavior changed;
- the files and contracts affected;
- the commands run and their results;
- Windows, container, or live-service checks that were not run;
- schema, migration, security, and operational consequences;
- any remaining uncertainty.
