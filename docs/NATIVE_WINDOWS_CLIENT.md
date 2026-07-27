# Native Windows client

The native client is a Tauri 2 application under `apps/windows-client`. React
renders the interface in WebView2. Rust owns all operating-system integration
and broker communication.

## Runtime boundary

The WebView Content Security Policy sets `connect-src 'none'`. The React
interface can call only the Tauri commands registered in `src-tauri/src/lib.rs`.
There is no generic network, shell, filesystem, installer, or updater command.

```text
React interface
  -> typed Tauri command
  -> Rust HTTPS client
  -> Appport broker
  -> Relution management API
  -> Relution Windows Agent
```

The application does not run Winget or installers. It does not contain the
Relution service token, OIDC client secret, or user OIDC token.

## User interface

The client provides:

- Apps, Updates, and Installed views;
- text search and application-source filtering;
- English and German text;
- install and update confirmation;
- action polling and explicit `unknown` warnings;
- sign-out status that distinguishes remote, credential, and task cleanup.

The interface does not display estimated installation percentages.

## Browser sign-in

The client:

1. binds an ephemeral listener on `127.0.0.1`;
2. generates a request ID, verifier, verifier challenge, and state value;
3. opens the broker `/native/connect` route in the system browser;
4. waits up to three minutes for the loopback callback;
5. validates state and exchanges the one-time code and verifier;
6. stores the resulting bearer in Windows Credential Manager.

The callback listener applies a two-second timeout per connection, accepts only
the expected callback path, and stops after a bounded number of invalid
callbacks.

Native sessions expire after eight hours and are not refreshed. A user can
have no more than three active sessions for one device. A schema upgrade that
introduces immutable identity binding revokes earlier native sessions.

## Device evidence

The client reads:

- EntDMID from enrolled OMADM registry data;
- SMBIOS system UUID and BIOS serial;
- the Windows hostname.

The broker performs matching and persists only a digest and selected result.
See [ARCHITECTURE.md](ARCHITECTURE.md#device-binding) for the match order and
failure behavior.

## Background update check

After successful sign-in, the client creates this per-user scheduled task:

```text
\Relution\Appport\<Windows SID>
```

The task:

- includes a logon trigger with a 15-minute delay;
- includes a daily trigger that repeats every four hours with up to 15 minutes
  of random delay;
- requires network availability;
- permits one running instance;
- stops after two minutes;
- runs as the interactive user with least privilege;
- executes the installed binary with `--background-check`.

The background process reads the current user's Credential Manager token,
calls `/api/native/bootstrap`, and exits. It displays a Windows notification
only when the approved update count is greater than zero and has increased.
English and German notification text is selected from the Windows locale.

The last count is stored in HKCU. Notification activation opens
`relution-appport://updates`.

## Sign-out and logs

Sign-out attempts:

1. broker-side native-session revocation;
2. Credential Manager deletion;
3. scheduled-task removal.

The client reports partial outcomes and does not claim success when credential
deletion fails.

Logs are written under `%LOCALAPPDATA%\Relution\Appport`. Values are clipped,
control characters are removed, and bearer or access-token markers are
redacted. Logging rotates between the current file and one previous file at
approximately 256 KiB per file.

## Development run

On Windows, provide a fixed HTTPS broker origin:

```powershell
$env:RELUTION_BROKER_URL = "https://apps.example.edu"
pnpm --dir apps/windows-client tauri dev
```

`RELUTION_BROKER_URL` is accepted only in debug builds. The broker certificate
must be trusted by the Windows host.

## MSI build

Use Windows 11 x64, the Rust MSVC toolchain, Node 24.18.x, pnpm 11.6.0, and the
WiX prerequisites required by Tauri.

Embed the production broker origin and run the repository script:

```powershell
$env:APPPORT_BROKER_URL = "https://apps.example.edu"
pnpm client:tauri
```

The Tauri build runs the client web build before packaging.

The repository does not pin the Rust or WiX installation versions and does not
contain a Windows-host setup script. Verify those prerequisites in the approved
Windows build environment before using this command.

The bundle configuration:

- targets MSI;
- keeps a stable WiX UpgradeCode;
- disables downgrades;
- configures English and German installer languages;
- expects the installed Evergreen WebView2 runtime;
- does not include the Tauri updater.

The repository does not contain a signing pipeline. Authenticode signing and
timestamping must occur in the organization's Windows build environment.

## Relution deployment

1. Build, sign, and timestamp the executable and MSI.
2. Create a Relution `WINDOWS_MSI` application.
3. Configure silent per-machine installation under the Relution Windows
   Agent's SYSTEM context with no restart.
4. Assign the package to a restricted managed Windows 11 x64 group.
5. Enable automatic Appport updates in Relution.
6. Set `APPPORT_NATIVE_APP_UUID` on the broker so Appport is not listed in its
   own catalog.

Because the bundle blocks downgrades, rollback requires either a signed
replacement whose version is accepted as an upgrade or a separately tested
managed uninstall and reinstall procedure.

## Windows validation

Portable checks do not establish the following:

- Windows-target Rust compilation;
- signed MSI creation;
- SYSTEM install, upgrade, rollback, and uninstall;
- WebView2 prerequisite behavior;
- Credential Manager isolation across users;
- OMADM and SMBIOS evidence on enrolled hardware;
- scheduled-task registration and removal;
- Windows notification display and protocol activation;
- Narrator, keyboard, high contrast, and 200% or 400% scaling;
- live Winget, MSI, and EXE actions;
- Appport self-update through Relution.

These checks remain release gates in
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
