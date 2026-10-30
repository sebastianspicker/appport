# Appport 0.1.0-alpha.4 — Pre-alpha Release Readiness Report

Audit date: 2026-10-15 (updated after owner answers to Q-1..Q-3) · Mode: AUDIT ONLY · Host: macOS arm64 (Windows-only paths read-verified only) · Ledger: `ALPHA_AUDIT_LEDGER.md`

## 1. Verdict

Appport is close to a creditable closed alpha in code terms, and far from one in evidence terms. The desktop client's core workflows (sign-in, catalog, install/update request, support bundle, background check) are fully implemented end to end with no stubs, no TODOs, no mock modes, strict compile-time configuration, careful session fencing, bounded I/O, and a serious test suite (92 frontend tests, a large Rust suite, architecture and docs gates). The owner has confirmed that the code has never run against a live Relution tenant. All repository gates pass on a pinned toolchain except one intermittent frontend test run and a Clippy lint that only fires on a newer Clippy than the pinned one. What stands between the project and an alpha is (a) the absence of any recorded live Relution qualification of this candidate, which is the only way the install workflow and device matching can be shown to work against real API responses; (b) one design gap that will bite testers early: an action that lands in `unknown` locks that application on that PC permanently with no recovery path; (c) a diagnostics gap: native errors are neither logged nor surfaced, so tester bug reports will be untriageable; and (d) the background update toast most likely never displays. Items (b)–(d) are each small to medium fixes. Item (a) is a process step, not code.

## 2. Findings by category, sorted by priority

Priorities: **P0** blocks alpha · **P1** testers will hit it · **P2** defer to beta. Effort: S < ½ day, M 1–3 days, L more. Full evidence and file:line in the ledger.

### Missing implementation
| ID | Pri | Title | Where | Effort |
| --- | --- | --- | --- | --- |
| F-13 | P0 | No evidence that the alpha.4 candidate ever completed a `pilotQualified=true` live run; W2/W3 unverified against real Relution responses | docs/OPERATIONS.md, .github/workflows/verify.yml | L (process) |
| F-2 | P0 | `unknown` action state is terminal, stays catalog-active, is never pruned and never reconciled: permanent per-(device, app) lock with no recovery | domain/action.rs:84-93, journal/storage.rs:9-16, application/actions.rs:191-216 | M |
| F-5 | P2 | Support details hard-code `matched_relution_last_ip/last_connection_at = None` and `last_seen_at = None`; UI labels always read "Not reported by Relution" | application/support.rs:107-110, interface/wire.rs:233 | S |

### Bug
| ID | Pri | Title | Where | Effort |
| --- | --- | --- | --- | --- |
| F-8 | P1 (unverified on Windows) | Toast uses an explicit AUMID (`com.relution.appport`) but the WiX bundle sets no `System.AppUserModel.ID` on the shortcut; background update notifications probably never show | infrastructure/windows/notifications.rs:64-69, tauri.conf.json:37-49 | M |
| F-4 | P2 (unverified) | One unclassifiable inventory row (`versionId` null, non-numeric labels, `hasUpdate` null) fails the entire catalog load with a generic "Service unavailable" | catalog_authorization.rs:52-56, domain/catalog.rs:168-199 | S |
| F-15 | P2 (intermittent) | `frontend-tests` gate failed once inside `pnpm verify:source`; 4 standalone runs passed 92/92 | apps/windows-client/vite.config.ts:21 | S |

### Fix / hardening
| ID | Pri | Title | Where | Effort |
| --- | --- | --- | --- | --- |
| F-3 | P1 | Native command errors are not logged (`native_error` only maps kind→code; `logging::write` is called only at startup/sign-in/support) and the UI drops the message; 14 `catch {}` sites; bug reports will carry no detail | interface/commands.rs:45-60, native-bridge/problem.ts:11-16 | S |
| F-16 | P1 | Source-gate runner stores child output only as a SHA-256 and prints `failed: <gate>`; a failing gate in `pnpm verify:source` or CI gives no diagnostics | scripts/alpha-evidence/commands.mjs:30-49 | S |
| F-9 | P2 | Polling every 2 s × 150 then manual "Resume"; 2–3 Relution requests per poll | catalog/usePollTimerRegistry.ts:11, useActionWorkflow.ts:17 | S |
| F-10 | P2 | Paginated POST "query" reads (users, devices, inventory) get no retry because `read = method == GET` | relution/transport.rs:214 | S |
| F-6 | P2 | Self-check reports `graceful_native_startup` as passed unconditionally | self_check.rs:51 | S |
| F-7 | P2 | Desktop race/session tests are `cfg(not(windows))`, so the Windows CI `cargo test` never runs them on the real target | application/desktop.rs:347-357, session.rs:192 | S |
| F-14 | P2 | `chunks_exact(2)` trips `clippy::chunks_exact_to_as_chunks` on Clippy 1.99; a Homebrew `cargo`/`cargo-clippy` ahead of rustup on PATH silently bypasses `rust-toolchain.toml`; `verify-toolchain.mjs` checks only Node | bin/qualification/input.rs:29, scripts/verify-toolchain.mjs | S |
| F-11 | P2 | Clean checkout on a current Node (26.11 here) cannot run the gates; pnpm/corepack not provisioned | scripts/verify-toolchain.mjs:9-13, package.json:8 | S |
| F-12 | P2 | `.pnpm-store/` not gitignored; created in repo root when the global store is unavailable | .gitignore | S |
| F-17 | P2 | No project licence/EULA and no third-party NOTICE file although MPL-2.0 crates and OFL fonts are bundled | README.md:66 | S |
| F-18 | P2 | SQLite journal has no schema version/migration path (`CHECK` constraint baked into `CREATE TABLE IF NOT EXISTS`) | journal/storage.rs:9-16 | S |
| F-1 | P2 | README has an orphaned sentence fragment with its link missing | README.md:62 | S |

**Build & test results (Phase 3, Node 26.5.1 + pnpm 11.6.0 + Rust 1.96.0 via rustup):** `pnpm install --frozen-lockfile` ✔ · toolchain ✔ · format ✔ · documentation ✔ · architecture ✔ · tooling-tests ✔ · evidence-tests ✔ · qualification ✔ · quality (lint/style/size/duplicates) ✔ · frontend-types ✔ · frontend-tests ✘ once / ✔ ×4 · frontend-build ✔ · rust-format ✔ · rust-clippy ✔ on the pinned Clippy 1.96.0 (✘ on Clippy 1.99 from Homebrew, see F-14) · rust-tests ✔ (non-Windows cfg) · rust-check ✔ · `pnpm demo:verify` ✔. Untested here by necessity: every `cfg(windows)` path (Credential Manager, ACLs, scheduled task, registry, toast, SMBIOS, MSI), and every live Relution call.

**Code sweep (Phase 4):** no TODO/FIXME/HACK; no `todo!/unimplemented!`; non-test `unwrap/expect` only at `lib.rs:133` (Tauri runtime) and two provably safe `expect("located icon")`; no debug prints in product paths; no hard-coded hosts (placeholders rejected at build); no mock mode; secrets never in args/env/files; swallowed errors only in the frontend (F-3).

**Hygiene (Phase 5):** configuration is compile-time and validated (good); error messages are localized but generic (F-3); logging inadequate for bug reports (F-3); data-loss risk limited to the journal lock (F-2) and journal migrations (F-18); authn via personal token in Credential Manager with generation fencing (good); authz fails closed with recursive group checks (good); wire input uses `deny_unknown_fields` (good); licences all permissive (F-17 for notices).

## 3. P0 items in recommended order

Owner answers (2026-10-15): the alpha is a private PoC in the owner's own tenant with per-user credentials (Q-1); the code has never run live (Q-2); "never resend `unknown`" is not a hard requirement (Q-3).

1. **F-2 – Add a recovery path for `unknown`** (P0, code, M). Because the code has never run live, the first live run is the most likely place to produce an `unknown`, and today that strands the (device, app) pair. Since Q-3 allows it: (a) in `get_action`, for `unknown` actions re-run `target_installed` and promote to `succeeded` when the exact package and version are in inventory; (b) allow a fresh request when the `unknown` action's correlated remote action is terminal or absent after a grace period (new `Transition` from `Unknown` to `Failed`/`Cancelled` with an explicit code), and (c) add an operator reset in the qualification utility or a documented journal maintenance step. Keep the UI warning and action ID. Depends on nothing.
2. **F-3 – Log native command errors and surface the detail** (P1, code, S). One `logging::write` in `native_error` with kind + sanitized detail, plus `NativeError.message` in the UI's support/details area. Precedes the live run so it produces usable logs.
3. **F-13 – Run and record the live qualification** (P0, process, L). `read_only` first, then `write_qualification` with a disposable plan per `docs/OPERATIONS.md`; keep `evidence.json` and `live-report.json` with the candidate. Needs tenant-operator approval and a Windows 11 x64 build host. Should run after items 1 and 2 are merged, on the exact candidate commit.
4. **F-8 – Verify toasts on an installed MSI** (P1, M) and, if they fail, add the AUMID to the WiX shortcut or fall back to the parameterless `CreateToastNotifier()` for the registered protocol. Can run during the same Windows session as item 3's self-check.

## 4. Assumptions and how the result changes if they are wrong

| ID | Assumption | If wrong |
| --- | --- | --- |
| D-1 | AUDIT ONLY | Nothing changes in the findings; Phase 7 would start with the order in §3. |
| D-2 | Alpha = testers in the single approved qualification tenant | Confirmed by Q-1 (private PoC, own tenant, per-user credentials). Per-org rebuild, unsigned MSI and licensing stay by-design/P2. |
| D-3 | Signing, distribution, uninstall, non-token auth out of scope | If signing is in scope, add a P0 for code-signing the MSI and the qualification utility. |
| D-5 | macOS host; Windows paths unverifiable here | F-8 and the `cfg(windows)` self-checks could flip to confirmed/cleared with one installed-MSI run. |
| Q-2 assumption | No live run has completed | Confirmed by Q-2; F-13 is P0 and F-2 escalated to P0. |

## 5. Open questions

None. Q-1, Q-2 and Q-3 were answered by the owner on 2026-10-15 (see §3 and the ledger). The remaining decision is whether to proceed to Phase 7 (AUDIT THEN FIX) for F-2, F-3 and F-8; F-13 requires the owner's Windows host and tenant approval.

## 6. Implementation results

Implementation date: 2026-10-30 · Branch: `alpha-readiness` (from `main` @ 5202ac5, not pushed) · Scope: P0 + P1 (assumed, see the implementation ledger's D-7) · Ledger: `ALPHA_IMPLEMENTATION_LEDGER.md`

### Verdict: READY WITH CONDITIONS

The owner delegated the remaining judgement calls on 2026-10-30 ("make judgement calls and finish alpha"). F-13 is therefore no longer a blocker before release. It is now the alpha's mandatory first step, because the alpha is a private PoC in the owner's own tenant and the owner is its first tester (D-20 in the implementation ledger). The conditions:

1. **Live qualification before anyone else is invited (F-13).**
   - The owner builds the candidate from `alpha-readiness` (final commit) on Windows 11 x64.
   - The owner runs `read_only`, then `write_qualification` with a disposable plan, following `docs/OPERATIONS.md`, and keeps `evidence.json` and `live-report.json`.
   - If either run fails, do not invite testers. Treat the failure as a new P0.
2. **Update toast seen on the installed MSI** during the same Windows session (F-8, verified from source only).
3. **Watch for F-19** during the write run: re-request an application after uninstalling it.
4. **Testers receive `ALPHA_KNOWN_ISSUES.md`.** It is linked from the README.

If the owner prefers the audit's original rule (no testers before a recorded live run, with F-13 as a blocker), the verdict reverts to NOT READY with F-13 as the only blocker. Nothing else changes.

### Findings in scope

| ID | Pri | Final status | Commit(s) | What changed |
| --- | --- | --- | --- | --- |
| F-2 | P0 | fixed | 6e119cb, 37831b5, 19b1626 | Each status check of an `unknown` action re-reads inventory and moves it to `succeeded` when the exact package and version are present. After 15 min unchanged, if Relution lists no matching or correlated action that would block a new request, it moves to `failed` with `UNKNOWN_RELEASED` and the app can be requested again. "Check status" button in the UI; the catalog reloads after a release. |
| F-3 | P1 | fixed | 18c2f3f | Every failed native command is written to `client.log` (which the support ZIP includes) as `command failed: <kind>: <detail>`. Every log line now carries a Unix timestamp. |
| F-16 | P1 | fixed | fa82b3b | `pnpm verify:source` prints the captured output of each failed gate. The evidence JSON still records only the digest. |
| F-8 | P1 | resolved-before-fix | — | The premise is wrong. Tauri CLI 2.11.4's WiX template sets `System.AppUserModel.ID = {{bundle_id}}` (`com.relution.appport`, identical to the toast AUMID) on the Start Menu shortcut, and the protocol is registered at startup. A runtime check is still owed (condition 1). |
| F-13 | P0 | blocked (Q-7) | — | Owner action, per `docs/OPERATIONS.md`. |

Two trivial P2s were fixed while finishing: F-1 (the orphaned README sentence now links the known issues and Operations) and F-12 (`.pnpm-store/` is gitignored). The other P2s (F-4, F-5, F-6, F-7, F-9, F-10, F-11, F-14, F-15, F-17, F-18) are deferred to beta, unchanged. F-4, F-5 and F-9 are described for testers in `ALPHA_KNOWN_ISSUES.md`. F-15 did not recur: frontend tests passed in every one of about 10 gate and standalone runs this session.

### New findings

- **F-19 (P2, unverified).** A matching Relution action in `EXECUTED` blocks new requests permanently, in both the preflight and the `unknown` release. If Relution keeps executed actions in history, reinstalling the same version after an uninstall is refused. Check it during the live run.
- **F-20 (P2).** The docs gate checks gitignored local Markdown, so a local `pnpm verify:source` can fail where a clean checkout passes. This was the only baseline failure.

### Gate results

- **Clean-checkout setup.** A fresh clone of `alpha-readiness` followed the README exactly: `pnpm install --frozen-lockfile` ✔, `pnpm verify:source` **15/15 ✔**, `pnpm demo:verify` ✔, `pnpm demo:build` ✔, and the `vite preview` demo serves (HTTP 200). The only deviation is that the pinned Node, pnpm and Rust were supplied via PATH; the README leaves installing them to the reader.
- **Workflow smoke runs.**
  - W3 (install/update) and the `unknown` path were exercised through mock-Relution application tests and frontend hook and page tests.
  - W4 (support) was traced to confirm the support ZIP includes `client.log`.
  - W6 (demo) was run.
  - W1, W2, W3, W5 and W7 were not run against a live tenant or on Windows (F-13).
- **Test delta against the baseline.**

  | Suite | Baseline | Now |
  | --- | --- | --- |
  | Rust lib | 203 passed, 1 ignored | 213 passed, 1 ignored (+5 domain, +4 application, +1 logging) |
  | Qualification bin | 8 | 8 |
  | Frontend | 92 | 94 (+2 hook tests; 1 page test gained an assertion) |
  | Gates | documentation ✘ (local artefact, F-20) | 15/15 ✔ on a clean clone |

  No test was disabled or weakened. One pinned legality assertion was updated for the intended behaviour change and moved to a new file (D-16).
- **Code sweep and hygiene on the changed files.** No TODO, `todo!`, `unwrap`, debug prints or swallowed errors were added. Every error detail is a fixed string, so the new log lines carry no secrets.
- **Independent review.** A reviewer subagent read the full diff. Two should-fix items, both confirmed and fixed in 19b1626:
  - the catalog stayed stale after a release;
  - "Check status" did nothing when hydration had failed.

  It found no blockers, races or layering violations.

### Tier 2 decisions to review

| Decision | Default chosen | If reversed |
| --- | --- | --- |
| D-7 / Q-4 scope | P0 + P1 | P0 only: F-3 and F-16 would be extra rather than required work. The verdict is unchanged. |
| D-14 / Q-5 `unknown` recovery | Inventory confirms → succeeded. After 15 min with no blocking Relution action → failed (`UNKNOWN_RELEASED`). | "Never auto-release": F-2 reopens unless an operator reset is built, and the verdict gains an F-2 blocker. A longer delay changes only the 900 s constant. |
| D-15 / Q-6 "Check status" button + reworded guidance | Keep | Automatic re-check per refresh: a small frontend change; no verdict impact. Full revert: F-2 is only partly fixed, because recovery waits for the next session. |
| D-17 / Q-8 log-only error detail | Log only; testers attach the support bundle | Showing detail on screen needs localized copy; no verdict impact. |
| D-20 F-13 as the alpha's first step, not a blocker before release | Owner runs the live qualification before inviting anyone | Back to blocker: verdict becomes NOT READY until the run is recorded. |
| D-21 keep version `0.1.0-alpha.4` | No bump; the alpha.4 release notes list the post-audit changes | Bumping to alpha.5 touches CI workflow paths, OPERATIONS.md, build messages and the WiX version. No verdict impact. |
