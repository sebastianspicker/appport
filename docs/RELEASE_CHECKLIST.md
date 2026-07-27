# Release checklist

Record dated results in [RELEASE_STATUS.md](../RELEASE_STATUS.md). A local
source check does not satisfy a Windows, container, live-service, or pilot
gate.

## Local candidate

- [ ] Node 24.18.x is selected from `.node-version`.
- [ ] `pnpm install --frozen-lockfile` succeeds from a clean checkout.
- [ ] `pnpm verify` passes.
- [ ] Coverage thresholds are defined and pass.
- [ ] The Docker image builds from the repository.
- [ ] `/api/health` and `/api/ready` pass as the non-root container user.
- [ ] Documentation links, commands, paths, route inventory, and variables are
  current.
- [ ] The runtime contract is reviewed.

## Pilot ready

- [ ] One broker replica runs with durable `/data` storage.
- [ ] Secret mounts and application files are read-only.
- [ ] The HTTPS proxy replaces forwarding headers and enforces the body limit.
- [ ] Backup, restore, and rollback procedures have named owners.
- [ ] An encrypted restore test is scheduled.
- [ ] The Windows x64 MSI is built, signed, and timestamped.
- [ ] Silent install, upgrade, rollback, uninstall, and WebView2 behavior are
  validated.
- [ ] Credential Manager, Task Scheduler, notifications, protocol activation,
  and accessibility are validated on managed Windows hardware.
- [ ] Read-only Relution validation covers identity, device binding,
  permissions, catalog, and inventory.
- [ ] Live canaries cover Winget, MSI, EXE, deferral, failure, lost response,
  restart correlation, and delayed inventory.
- [ ] The portable-bearer and username-lookup risks have named owners and
  expansion exit criteria.

## Pilot validated

- [ ] The signed MSI is assigned only to the named pilot group.
- [ ] One full week of evidence covers authentication, device matching,
  authorization, actions, `unknown` states, scheduled checks, notifications,
  and database health.
- [ ] Evidence includes live Relution reads and approved canaries.
- [ ] Rollback readiness is verified without deleting active or `unknown`
  action evidence.
- [ ] The risk review approves expansion or continued restriction.
