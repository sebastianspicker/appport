# Appport design brief

This brief records the evidence, decisions, and assumptions behind the 2026 visual
redesign of the Windows client (`apps/windows-client`) and the browser demo
(`apps/web-demo`). It is a design record, not product documentation; behavior and
contracts are described in [README](README.md) and [Architecture](docs/ARCHITECTURE.md).

## Product summary

Appport is a self-service software catalog for Relution-managed Windows 11 PCs. A
person signs in with a Relution username and a personal, expiring access token. The
client then shows two lists for the one device it runs on:

- **Available**: approved software not yet installed.
- **Updates**: approved newer versions of software already installed.

A request goes through a deliberate, single-shot path: review, confirm, reserve the
action locally, send exactly one deployment request, poll its state (Queued, Sent,
Waiting for device, Verifying), and report success only after Relution inventory
shows the exact expected version. A result that cannot be determined is locked as
"unknown" with an action ID the person gives to IT; it must never be retried blindly.
A Support view shows device identity (name, user, Windows build, manufacturer, model,
SMBIOS serial, last MDM IP and connection) and creates a local support ZIP.

**Moment of value:** the instant a request is confirmed by inventory on *this* PC —
"Installation confirmed on PC-HR-0147." Everything before it is a path to that
receipt; everything that blocks it must explain itself.

## Audience

**Primary: the person at a managed PC.** An office worker, lecturer, researcher, or
administrator in a German-speaking organization that runs Relution (English is the
second locale). They are not IT staff, but they know their machine is managed and
that doing the wrong thing can create a ticket or a compliance problem. They come
with one goal ("I need GIMP", "Teams keeps nagging about an update") and want to
leave within a minute.

- *Tools they use daily:* Windows 11, Outlook/Teams, a browser, line-of-business
  software. Their reference for "official software" is Microsoft's Company Portal or
  Software Center.
- *Anxieties:* breaking the PC, installing the wrong thing, being blamed, not knowing
  whether something actually happened, having to explain an error to the helpdesk.
- *What they distrust:* spinners without explanation, vague success messages, consumer
  app-store theatrics (ratings, banners, "featured"), anything that looks like it
  could be a phishing page asking for a token.
- *What signals quality to them:* calm, plain language; exact version numbers; the
  device's own name shown back to them; an honest "unknown" instead of fake success;
  something they can read aloud to IT without spelling ambiguity.

**Secondary: the helpdesk agent on the other end.** They never see the UI, but they
receive what the user reads to them: action IDs, serials, versions, device names.
Legibility of those strings (0/O, 1/l/I, 5/S) matters more here than anywhere else.

## Key journeys

1. **Install approved software:** open (already signed in) → Available → search or
   scan → open a row → review installation → request installation → watch status →
   confirmation receipt; the row leaves the list.
2. **Apply an update:** Updates (count is visible from Available) → compare installed
   and target versions → review → request → confirmation.
3. **Recover from a failed or unknown request:** the row opens itself, explains the
   state, offers Retry only when retrying is safe, and otherwise shows the action ID
   to give to IT.
4. **Get help:** Support → read or copy device details → generate a local support ZIP
   → open its folder.
5. **First run or expired token:** sign in with username and personal token; get a
   link to manage tokens in Relution.
6. **Account:** see who and which device, replace the token, sign out (with honest
   partial-failure messaging).

## Brand traits

| Trait | Not tipping into |
| --- | --- |
| **Exact**: every number, version, and ID is shown precisely and legibly. | Pedantic: no raw internal codes where words work. |
| **Calm**: unhurried, plain, low-noise. | Bland: the interface still has a recognizable voice and form. |
| **Accountable**: says what happened, what did not, and who to ask. | Alarmist: warnings are proportionate and specific. |
| **Workmanlike**: feels like a well-made tool issued with the machine. | Cold or bureaucratic: copy speaks to a person, not a ticket. |
| **Local**: everything is about *this* device. | Parochial: still reads as a product, not an internal script. |

## Market observations

Reasoned from knowledge of the category (Microsoft Intune Company Portal, ConfigMgr
Software Center, Jamf Self Service, Kandji/Iru Self Service, Workspace ONE Intelligent
Hub, ManageEngine self-service portals); no live browsing was done for this brief.

Conventions **to honor**, because users rely on them:

- App icon + name + publisher as the identity of a row.
- A clear primary verb per item (Install / Update) and a visible status per request.
- Separate "updates" from "new software"; show an update count.
- Device and account identity available from a predictable place.

Conventions **to break**, because they make every portal look the same:

- Fluent-blue accent buttons and tile grids imitating a consumer app store.
- Featured banners, categories-as-hero, marketing illustrations.
- Ambiguous single-word statuses ("Installing…") with no idea of the stage.
- Sans-serif-everything with no typographic distinction between *names* (human) and
  *identifiers* (machine).

## Current state

- **Stack:** React 19 + Vite + Tauri 2, plain CSS files per feature imported by
  `src/styles.css`, CSS custom properties in `ui/foundation.css`, a 12-glyph inline
  SVG icon set (`ui/Icon.tsx`), bundled Source Sans 3 + Manrope TTFs. The demo has a
  separate, older Fluent-style theme (blue accent, sidebar rail, card grid,
  system fonts) and no bundled fonts.
- **Worth keeping (brand equity):** the black square brand mark; the **signal yellow**
  active-tab bar (the only memorable color in the client); the restrained, nearly
  monochrome palette; the list (not grid) layout; the honest, careful copy about
  tokens and unknown results; `forced-colors` and reduced-motion support.
- **Weaknesses:**
  - A 56px "Software" headline plus a repeated brand header consume a third of the
    default 1100 × 760 window before the first application appears.
  - The device — the subject of the whole product — is a 14px line.
  - Expanded rows repeat the name and description already shown above them.
  - Long versions (`24215.1007.3082.1590 → …`) wrap mid-number; versions are set in the
    body face, so 0/O and 1/l are ambiguous in IDs and serials.
  - Support view still shows the catalog tabs (none active) and Refresh.
  - Sign-in repeats the same token sentence twice; the panel reads as a generic login.
  - Three highlight colors (yellow, cyan, magenta) with no defined roles.
  - Status pills, inline errors, and notes each use different radii and sizes.
  - The demo looks like a different, generic product (Fluent blue, cards, rail).

## Constraints

- **Functional:** keep every flow, state, command, and wire contract; keep
  `CatalogControl` wiring, generation fencing, focus management, `role`/`aria-live`
  semantics, and test-visible labels unless copy is deliberately rewritten (tests
  updated with it).
- **Security/CSP:** `connect-src 'none'`, `style-src 'self'`, `font-src` falls back to
  `'self'`; fonts must be bundled files, no remote CSS or fonts in either app. The demo
  must not import desktop source; it gets its own copy of the fonts and styles.
- **Window:** Tauri window 1100 × 760, `minWidth` 720. The client never runs on a
  phone, but must remain usable at 720 and robust at narrower widths. The demo is a
  public web page and must be designed for 390px phones.
- **Accessibility:** WCAG 2.2 AA contrast in light, dark, and `forced-colors`; 44px
  targets; visible focus; keyboard-only paths through dialogs and the task view.
- **i18n:** English and German; German strings run ~30% longer.
- **Repository gates:** files ≤ 500 lines, stylelint-standard, jscpd duplicate limits,
  Prettier, ESLint, `pnpm verify:source` and `pnpm demo:verify`.

## Assumptions log

| # | Assumption | Evidence | Confidence |
| --- | --- | --- | --- |
| A1 | Primary users are non-IT staff in German-speaking organizations. | `de` locale is first-class; Relution is a German MDM; copy addresses end users and defers to "IT". | High |
| A2 | Users frequently relay IDs, serials, and versions to a helpdesk. | Unknown-state copy ("Give this action ID to IT"), Copy device details, support ZIP. | High |
| A3 | The default window size (1100 × 760) is the dominant viewport. | `tauri.conf.json`; managed desktops rarely resize utility windows. | Medium |
| A4 | Catalogs are small to medium (≈5–80 items per view). | Per-device assignment; Available/Updates split; no pagination or categories in the API. | Medium |
| A5 | Many apps have no icon (`hasIcon: false`), so the letter placeholder is common. | Optional icon in the contract; lazy icon pool. | Medium |
| A6 | Organizations may be universities or schools as well as companies. | Relution's market; nothing in the code is sector-specific. Design must not depend on sector. | Low |
| A7 | Dark mode is used by a meaningful share of users. | Existing dark tokens; README advertises system-theme following. | Medium |
| A8 | The yellow active bar is recognized brand equity worth keeping. | It is the only non-neutral brand color used in the client and the README tour. | Medium |
| A9 | Users trust a tool that looks "issued with the machine" more than one that looks like a consumer store. | Category norms (Company Portal, Software Center); token-handling anxiety. | Medium |

## Design direction

### Direction 1 — Rating plate (*Typenschild*)

**Concept.** Every managed PC carries an asset label: a small, precise plate with the
device name, model, serial, and status. Appport is the software counterpart of that
plate. The device is the subject of every screen; the catalog is "what this machine
may receive"; a request is stamped onto the plate when inventory confirms it. Fits
A1/A2/A9: it borrows the grammar of things the user already trusts as official,
and it makes identifiers first-class.

- **Typography.** *Atkinson Hyperlegible Next* (variable 200–800) for all language,
  *Atkinson Hyperlegible Mono* (variable, slashed zero) for every machine string:
  versions, action IDs, serials, device names, counts, and small-caps labels.
  Both were designed by the Braille Institute for character disambiguation, which is
  exactly the job here (A2). Scale (px, 1.2 minor-third, tuned): 12 · 13 · 15 · 17 ·
  20 · 24 · 30. Labels: mono 12px, uppercase, +0.08em tracking.
- **Color.** Label stock and ink. Light: paper `#F7F6F2`, plate `#FFFFFF`, ink
  `#16171B`. Dark: `#121316` / `#1A1B1F` / `#ECEBE6`. One signal: **safety yellow**
  `#FFD400`, used only as a *mark* (active view, the version that will change,
  focus fill on the plate), never for text on light backgrounds. Status roles:
  confirmed green, failed red, attention amber; each a text color plus a quiet tint.
  Cyan and magenta are retired.
- **Layout.** A compact top band holds brand, the device plate, Support, and Account.
  Below it, a single control row (views as tabs, search, source filter, refresh).
  The catalog is a ruled ledger with fixed columns — *Application · Source ·
  Version · action* — at a 4px base grid, comfortable density (64px rows), with the
  first application visible above the fold at 760px height. 1px rules, 2px radii:
  plates are cut, not pillowed.
- **Motion.** Almost none. The request track fills stage by stage (120ms, ease-out,
  transform only); the indeterminate bar slides; dialogs fade in 120ms. Everything
  is removed under `prefers-reduced-motion`.
- **Signature details.** (1) The *device plate* in the header: mono device name on a
  bordered plate with a yellow status notch. (2) The *request track*: four segments —
  Requested · Sent · Verifying · Confirmed — that fill with ink as Relution reports
  progress, replacing a lone spinner with an honest position. (3) The *marked version*:
  in Updates, the target version sits on a yellow highlighter mark —
  `8.6.9 → `<mark>`8.7`</mark> — the one thing that will change.
- **Breaks from category.** No tiles, no blue, no hero; identifiers are typeset as
  identifiers; status is a position on a track, not a mood.
- **Refuses.** Rounded cards with shadows, gradients, illustrations, star ratings,
  "featured" rows, emoji, and decorative motion.

### Direction 2 — Counter-signed slip

**Concept.** Each request is a carbon-copy slip: the user fills it in, IT's system
counter-signs it. The entire UI is built around slips: the catalog is a stack of
blank slips; the task view is the slip being filled; confirmation is the stamped
copy. Strong on accountability and the unknown state ("slip lost in transit — give
this number to IT").

- **Typography.** A typewriter-like mono (*IBM Plex Mono*) for almost everything,
  with a condensed grotesk (*Barlow Semi Condensed*) for headings.
- **Color.** Carbon-paper blue-black ink on pale pink/yellow slip tints per state.
- **Layout.** Narrow centered column of slips; one slip open at a time; perforated
  dividers.
- **Motion.** Slip "tears off" into a receipt tray on confirmation.
- **Signature.** Perforation edges; a rubber-stamp CONFIRMED mark.
- **Breaks from category.** Nobody ships a paper metaphor for MDM.
- **Refuses.** Lists and tables.

*Risks:* mono-heavy text slows scanning of a 40-item list; a slip implies a purchase
or form-filing; skeuomorphic perforations and stamps age quickly and fight
`forced-colors`; the narrow column wastes the desktop window.

### Direction 3 — Library index

**Concept.** The approved catalog as a library's card index: alphabetical, quietly
scholarly, with large serif names and letter dividers (A, G, K …). Appeals to
universities and public institutions; reading-first.

- **Typography.** *Newsreader* (serif, optical sizes) for names and headings,
  *Source Sans 3* for UI.
- **Color.** Warm paper, oxblood accent, ink.
- **Layout.** Two-column index with sticky letter dividers; generous leading.
- **Motion.** None beyond focus.
- **Signature.** Letter dividers; call-number style package identifiers.
- **Breaks from category.** Editorial rather than app-store.
- **Refuses.** Icons-as-identity; status color beyond one accent.

*Risks:* depends on the low-confidence sector assumption (A6); serif display in a
Windows utility reads as a website, not a tool; letter dividers are noise in small
catalogs (A4); weak on the status/unknown journeys that matter most.

### Choice

**Direction 1, Rating plate.** It is the only direction whose central idea comes from
the product's core promise — *exact, verified change to this specific machine* — and
it improves the journeys that matter most (status, unknown results, relaying IDs to
IT) rather than decorating the catalog. It keeps the existing brand equity (black
mark, yellow signal, list layout) and evolves it rather than discarding it. It is
robust to A6 (sector-neutral) and A3 (the ledger works from 720px to wide windows,
and collapses to stacked plates on phones for the demo).

From Direction 2 it borrows only the honest progress track. It trades away the
warmth and memorability of a strong metaphor (Direction 2) and the reading comfort
of a serif (Direction 3) in favor of speed, legibility, and trust.

**Exceptions to the anti-pattern list:** none. Atkinson Hyperlegible is not a system
default; color is flat; the only "card-like" object, the device plate, is a 1px
ruled label without shadow.

## Implementation record

**System.** Tokens live in `apps/windows-client/src/ui/foundation.css` (type scale,
4px spacing, color roles for light, dark, and `forced-colors`, radii, stroke, motion)
and are repeated in `apps/web-demo/src/demo-app-shell.css`, because the demo may not
import desktop source. Fonts are bundled as Latin-subset WOFF2 files (≈49 KB for
both families, replacing ≈810 KB of TTF).

**Structural changes (no behavior change):**

- The top band now holds the brand, a *device plate* (assigned-device label, device
  name, Relution status), Support, and Account, in that order. The device line and
  the "·" separator above the page title are gone.
- Catalog rows gain a Source column; the source chip left the publisher line.
- The target version in Updates carries the yellow mark; installed versions are
  muted. Versions, IDs, serials, and device names use the mono face.
- Expanded rows no longer repeat the application name and description, and the
  redundant "Update available" pill is removed from the version rail.
- Polling shows a four-stage request track (Requested · Sent · Verifying ·
  Confirmed) as the existing `progressbar` element. Stage mapping: queued → 1;
  sent/deferred → 2; verifying → 3.
- Refresh is hidden while Support is open (it only reloads the catalog).
- Sign-in becomes a two-column layout with an ink introduction (what Appport is,
  three steps); fields and handlers are unchanged.
- Device-status dot is green only for `COMPLIANT`; other statuses get a neutral dot.
- The web demo adopts the client's structure: disclosure band, top band with device
  plate, tabs, ledger rows, request track, ruled support plate and dialog.

**Copy changes** (English and German): page title "Approved software"; summaries for
catalog and support; a token hint that says "not your password"; one token-guidance
sentence instead of a repeated one; a more specific empty state; "Missing
something?" guidance; read-only, permission, confirmation-warning, and receipt
sentences that describe exactly what Appport checks and confirms; "Publisher not
listed" instead of "Approved software" as the publisher fallback. Demo: "Verifying
installation" / "Verifying update" instead of "Verifying", one demo test updated
for that and for the new "Freigegebene Software" title.

**Unresolved.** On start-up the signed-out shell (sign-in form) is shown while the
first catalog load is in flight, so a signed-in user can briefly see the form.
Fixing it means changing when `ConnectForm` mounts, which would affect its
submitted-error state, so it is left for a behavioral change with its own tests.
