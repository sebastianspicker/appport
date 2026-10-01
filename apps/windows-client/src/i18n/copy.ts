import type { ClientProblem } from "../native-bridge/types";

export type Locale = "en" | "de";

export const text = {
  en: {
    catalogToolbar: "Search and filter software",
    clearFilters: "Clear filters",
    resultCount: "{count} application",
    resultsCount: "{count} applications",
    filteredResultsCount: "{count} of {total} applications",
    skipToContent: "Skip to content",
    forThisDevice: "For this device",
    softwareMissing: "Missing something?",
    account: "Account",
    close: "Close",
    signingIn: "Signing in…",
    signingOut: "Signing out…",
    signOutWaiting: "Finishing any submitted work before signing out.",
    portalOpening: "Opening Relution…",
    portalFailed: "Relution could not be opened. Try again.",
    tokenHint:
      "Not your password: a personal, expiring token from your Relution profile.",
    deviceDetails: "Device details",
    shareWithIT: "Share details with IT",
    appTitle: "Appport",
    managedSoftware: "Managed software",
    signInTitle: "Sign in to Appport",
    signInSummary:
      "Use your Relution username and a personal access token. Your organization decides which software appears here.",
    signInPitch: "The software your organization approved for this PC.",
    signInSteps: [
      "Sign in with a personal Relution token.",
      "Choose approved software or an update.",
      "Relution installs it. Appport confirms the exact version on this PC.",
    ],
    availableSummary: "Software approved for this device by your organization.",
    updatesSummary: "Updates approved for software already on this device.",
    connected: "Connected",
    version: "Version",
    actionQueued: "Queued",
    actionSent: "Sent to device",
    actionDeferred: "Waiting for device",
    actionVerifyingInstall: "Verifying installation",
    actionVerifyingUpdate: "Verifying update",
    actionSucceeded: "Succeeded",
    actionFailed: "Failed",
    actionCancelled: "Cancelled",
    currentDevice: "Current device only",
    forDevice: "For this device",
    signIn: "Sign in",
    connect: "Connect",
    signOut: "Sign out",
    replaceToken: "Renew or replace token",
    manageToken: "Manage token in Relution",
    relutionUsername: "Relution username",
    accessToken: "Personal access token",
    tokenGuidance:
      "Appport cannot revoke tokens. Revoke a replaced or exposed token in your Relution profile.",
    apps: "Available",
    updates: "Updates",
    search: "Search",
    searchPlaceholder: "Search approved software",
    source: "Source",
    allSources: "All sources",
    noSearchResults: "No approved software matches your search.",
    loading: ["Loading this device", "Checking your approved software."],
    empty: [
      "Nothing here right now",
      "No approved software is waiting in this view. New assignments from IT appear here.",
    ],
    offline: ["You are offline", "Connect to the internet and try again."],
    sessionExpired: ["Your session expired", "Sign in again to continue."],
    authorizationDenied: [
      "Access is not authorized",
      "Your account or token lacks required Relution access. Contact the Relution administrator.",
    ],
    deviceFailed: [
      "This device is not assigned",
      "Use the device assigned to your account or contact support.",
    ],
    server: [
      "Service unavailable",
      "The software service could not complete your request.",
    ],
    actionStartFailed: [
      "Action could not be started",
      "Try again. If it keeps failing, contact support.",
    ],
    unknown: ["Something went wrong", "Try again in a moment."],
    refresh: "Refresh",
    retry: "Try again",
    approved: "Publisher not listed",
    approvedForDevice: "Approved for this device.",
    available: "Available",
    installedVersion: "Installed version",
    availableVersion: "Available version",
    install: "Install",
    update: "Update",
    readOnly:
      "Read-only build: you can browse, but installs and updates are switched off.",
    retryAction: "Retry",
    starting: "Starting…",
    status: "Status",
    polling: "Checking action status:",
    pollingPaused: "Status checks paused. Resume with this action ID:",
    resumePolling: "Resume status checks",
    unknownAction:
      "The final result is unknown. Do not retry. Give this action ID to IT:",
    confirmAction: "Confirm {intent}",
    confirmInstall: "Install",
    confirmUpdate: "Update",
    targetVersion: "Target version",
    cancel: "Cancel",
    confirm: "Confirm",
    confirmationWarning:
      "This request is sent once. If its result stays unknown, do not request again; give IT the action ID instead.",
    backgroundCheckUnavailable:
      "Background update checks could not be registered. Keep Appport open to receive update status.",
    signOutIncomplete:
      "Sign-out is incomplete because this device could not delete its stored credential. Contact IT before using this shared device.",
    signOutPartial:
      "Signed out locally. Revoke the token in your Relution profile if it is no longer needed; some background cleanup did not complete.",
    signOutFailed:
      "Sign-out could not run. Your stored credential may still be present. Try again or contact IT.",
    support: "Support",
    supportSummary: "What IT needs to help with this PC.",
    supportGuidance:
      "Appport lists only software assigned to you in Relution. Ask IT to assign it.",
    supportWindows: "Windows display and build",
    supportManufacturer: "Manufacturer",
    supportModel: "Model",
    supportSerial: "SMBIOS serial",
    supportRelutionConnection: "Relution last connection",
    supportRelutionIp: "Last MDM IP",
    supportDeviceStatus: "MDM/device status",
    supportAppVersion: "Appport version",
    supportSourceRevision: "Source revision",
    supportAssignedCount: "Assigned software",
    supportAvailableCount: "Available software",
    supportUpdateCount: "Available updates",
    notAvailable: "Not available",
    notReportedByRelution: "Not reported by Relution",
    copyDeviceDetails: "Copy device details",
    generateSupportBundle: "Generate support bundle",
    openSupportFolder: "Open support folder",
    supportLoading: "Loading support details…",
    supportCopied: "Device details copied.",
    supportGenerating: "Generating local support bundle…",
    supportBundleCreated: "Support bundle created: {name} ({size}).",
    supportWarnings: "{count} collection warning(s).",
    supportLoadFailed: "Support details could not be loaded. Try again.",
    supportCopyFailed: "Device details could not be copied. Try again.",
    supportGenerationFailed:
      "The support bundle could not be generated. Try again or contact IT.",
    supportFolderFailed: "The support folder could not be opened. Try again.",
    supportConfirmTitle: "Generate support bundle",
    supportConfirmDescription:
      "The ZIP stays on this device until you manually share it.",
    supportUsername: "Relution username",
    supportDeviceName: "Device name",
    reviewedVersion: "Reviewed version",
    software: "Approved software",
    summary: "Chosen for this PC by your organization.",
    assignedDevice: "Assigned device",
    application: "Application",
    view: "View",
    back: "Back to overview",
    reviewInstall: "Review installation",
    reviewUpdate: "Review update",
    requestInstall: "Request installation",
    requestUpdate: "Request update",
    permission:
      "Appport checks your permission and this PC's inventory again before anything is sent.",
    installed: "Installation confirmed",
    updated: "Update confirmed",
    receipt: "Inventory on {device} shows the new version.",
    task: "Installation status",
    trackRequested: "Requested",
    trackSent: "Sent",
    trackVerifying: "Verifying",
    trackConfirmed: "Confirmed",
  },
  de: {
    catalogToolbar: "Software suchen und filtern",
    clearFilters: "Filter zurücksetzen",
    resultCount: "{count} Anwendung",
    resultsCount: "{count} Anwendungen",
    filteredResultsCount: "{count} von {total} Anwendungen",
    skipToContent: "Zum Inhalt springen",
    forThisDevice: "Für dieses Gerät",
    softwareMissing: "Etwas fehlt?",
    account: "Konto",
    close: "Schließen",
    signingIn: "Anmeldung läuft…",
    signingOut: "Abmeldung läuft…",
    signOutWaiting:
      "Bereits gestartete Vorgänge werden vor der Abmeldung abgeschlossen.",
    portalOpening: "Relution wird geöffnet…",
    portalFailed:
      "Relution konnte nicht geöffnet werden. Versuchen Sie es erneut.",
    tokenHint:
      "Nicht Ihr Passwort: ein persönlicher, ablaufender Token aus Ihrem Relution-Profil.",
    deviceDetails: "Gerätedetails",
    shareWithIT: "Details an die IT weitergeben",
    appTitle: "Appport",
    managedSoftware: "Verwaltete Software",
    signInTitle: "Bei Appport anmelden",
    signInSummary:
      "Mit Ihrem Relution-Benutzernamen und einem persönlichen Zugriffstoken. Ihre Organisation legt fest, welche Software hier erscheint.",
    signInPitch:
      "Die Software, die Ihre Organisation für diesen PC freigegeben hat.",
    signInSteps: [
      "Mit einem persönlichen Relution-Token anmelden.",
      "Freigegebene Software oder ein Update wählen.",
      "Relution installiert. Appport bestätigt die genaue Version auf diesem PC.",
    ],
    availableSummary:
      "Von Ihrer Organisation für dieses Gerät freigegebene Software.",
    updatesSummary:
      "Freigegebene Updates für bereits auf diesem Gerät vorhandene Software.",
    connected: "Verbunden",
    version: "Version",
    actionQueued: "In Warteschlange",
    actionSent: "An das Gerät gesendet",
    actionDeferred: "Warten auf das Gerät",
    actionVerifyingInstall: "Installation wird überprüft",
    actionVerifyingUpdate: "Update wird überprüft",
    actionSucceeded: "Erfolgreich",
    actionFailed: "Fehlgeschlagen",
    actionCancelled: "Abgebrochen",
    currentDevice: "Nur dieses Gerät",
    forDevice: "Für dieses Gerät",
    signIn: "Anmelden",
    connect: "Verbinden",
    signOut: "Abmelden",
    replaceToken: "Token erneuern oder ersetzen",
    manageToken: "Token in Relution verwalten",
    relutionUsername: "Relution-Benutzername",
    accessToken: "Persönlicher Zugriffstoken",
    tokenGuidance:
      "Appport kann Token nicht widerrufen. Widerrufen Sie ersetzte oder offengelegte Token in Ihrem Relution-Profil.",
    apps: "Verfügbar",
    updates: "Updates",
    search: "Suchen",
    searchPlaceholder: "Freigegebene Software suchen",
    source: "Quelle",
    allSources: "Alle Quellen",
    noSearchResults: "Keine freigegebene Software entspricht Ihrer Suche.",
    loading: [
      "Dieses Gerät wird geladen",
      "Ihre freigegebene Software wird geprüft.",
    ],
    empty: [
      "Zurzeit nichts vorhanden",
      "In dieser Ansicht wartet keine freigegebene Software. Neue Zuweisungen der IT erscheinen hier.",
    ],
    offline: [
      "Sie sind offline",
      "Stellen Sie eine Internetverbindung her und versuchen Sie es erneut.",
    ],
    sessionExpired: [
      "Ihre Sitzung ist abgelaufen",
      "Melden Sie sich erneut an.",
    ],
    authorizationDenied: [
      "Zugriff nicht autorisiert",
      "Ihr Konto oder Token hat nicht den erforderlichen Relution-Zugriff. Wenden Sie sich an die Relution-Administration.",
    ],
    deviceFailed: [
      "Dieses Gerät ist nicht zugeordnet",
      "Verwenden Sie ein zugeordnetes Gerät oder wenden Sie sich an den Support.",
    ],
    server: [
      "Dienst nicht verfügbar",
      "Der Softwaredienst konnte die Anfrage nicht abschließen.",
    ],
    actionStartFailed: [
      "Aktion konnte nicht gestartet werden",
      "Versuchen Sie es erneut oder wenden Sie sich an den Support.",
    ],
    unknown: ["Ein Fehler ist aufgetreten", "Versuchen Sie es später erneut."],
    refresh: "Aktualisieren",
    retry: "Erneut versuchen",
    approved: "Herausgeber nicht angegeben",
    approvedForDevice: "Für dieses Gerät freigegeben.",
    available: "Verfügbar",
    installedVersion: "Installierte Version",
    availableVersion: "Verfügbare Version",
    install: "Installieren",
    update: "Aktualisieren",
    readOnly:
      "Schreibgeschützte Version: Sie können sich umsehen, aber Installationen und Updates sind ausgeschaltet.",
    retryAction: "Erneut versuchen",
    starting: "Wird gestartet…",
    status: "Status",
    polling: "Aktionsstatus wird geprüft:",
    pollingPaused: "Statusprüfung pausiert. Mit dieser Aktions-ID fortsetzen:",
    resumePolling: "Statusprüfung fortsetzen",
    unknownAction:
      "Das Endergebnis ist unbekannt. Nicht erneut starten. Diese Aktions-ID an die IT weitergeben:",
    confirmAction: "{intent} bestätigen",
    confirmInstall: "Installieren",
    confirmUpdate: "Aktualisieren",
    targetVersion: "Zielversion",
    cancel: "Abbrechen",
    confirm: "Bestätigen",
    confirmationWarning:
      "Diese Anfrage wird einmal gesendet. Bleibt ihr Ergebnis unbekannt, fordern Sie nicht erneut an, sondern geben Sie der IT die Aktions-ID.",
    backgroundCheckUnavailable:
      "Hintergrundprüfungen für Updates konnten nicht registriert werden. Lassen Sie Appport geöffnet, um Update-Status zu erhalten.",
    signOutIncomplete:
      "Die Abmeldung ist unvollständig, weil dieses Gerät die gespeicherte Anmeldeinformation nicht löschen konnte. Wenden Sie sich vor der Nutzung dieses gemeinsam verwendeten Geräts an die IT.",
    signOutPartial:
      "Lokal abgemeldet. Widerrufen Sie den Token in Ihrem Relution-Profil, wenn er nicht mehr benötigt wird; ein Teil der Hintergrundbereinigung ist fehlgeschlagen.",
    signOutFailed:
      "Die Abmeldung konnte nicht ausgeführt werden. Die gespeicherte Anmeldeinformation kann noch vorhanden sein. Versuchen Sie es erneut oder wenden Sie sich an den Support.",
    support: "Support",
    supportSummary: "Was die IT braucht, um bei diesem PC zu helfen.",
    supportGuidance:
      "Appport zeigt nur Software, die Ihnen in Relution zugewiesen ist. Bitten Sie die IT um eine Zuweisung.",
    supportWindows: "Windows-Anzeige und Build",
    supportManufacturer: "Hersteller",
    supportModel: "Modell",
    supportSerial: "SMBIOS-Seriennummer",
    supportRelutionConnection: "Letzte Relution-Verbindung",
    supportRelutionIp: "Letzte MDM-IP",
    supportDeviceStatus: "MDM-/Gerätestatus",
    supportAppVersion: "Appport-Version",
    supportSourceRevision: "Quellrevision",
    supportAssignedCount: "Zugewiesene Software",
    supportAvailableCount: "Verfügbare Software",
    supportUpdateCount: "Verfügbare Updates",
    notAvailable: "Nicht verfügbar",
    notReportedByRelution: "Nicht von Relution gemeldet",
    copyDeviceDetails: "Gerätedetails kopieren",
    generateSupportBundle: "Supportpaket erstellen",
    openSupportFolder: "Supportordner öffnen",
    supportLoading: "Supportdetails werden geladen…",
    supportCopied: "Gerätedetails wurden kopiert.",
    supportGenerating: "Lokales Supportpaket wird erstellt…",
    supportBundleCreated: "Supportpaket erstellt: {name} ({size}).",
    supportWarnings: "{count} Erfassungswarnung(en).",
    supportLoadFailed:
      "Supportdetails konnten nicht geladen werden. Versuchen Sie es erneut.",
    supportCopyFailed:
      "Gerätedetails konnten nicht kopiert werden. Versuchen Sie es erneut.",
    supportGenerationFailed:
      "Das Supportpaket konnte nicht erstellt werden. Versuchen Sie es erneut oder wenden Sie sich an die IT.",
    supportFolderFailed:
      "Der Supportordner konnte nicht geöffnet werden. Versuchen Sie es erneut.",
    supportConfirmTitle: "Supportpaket erstellen",
    supportConfirmDescription:
      "Die ZIP-Datei bleibt auf diesem Gerät, bis Sie sie manuell weitergeben.",
    supportUsername: "Relution-Benutzername",
    supportDeviceName: "Gerätename",
    reviewedVersion: "Version bei Prüfung",
    software: "Freigegebene Software",
    summary: "Von Ihrer Organisation für diesen PC ausgewählt.",
    assignedDevice: "Zugeordnetes Gerät",
    application: "Anwendung",
    view: "Ansehen",
    back: "Zurück zur Übersicht",
    reviewInstall: "Installation vorbereiten",
    reviewUpdate: "Update vorbereiten",
    requestInstall: "Installation anfordern",
    requestUpdate: "Update anfordern",
    permission:
      "Appport prüft Ihre Berechtigung und den Softwarebestand dieses PCs vor dem Senden erneut.",
    installed: "Installation bestätigt",
    updated: "Update bestätigt",
    receipt: "Der Softwarebestand von {device} zeigt die neue Version.",
    task: "Installationsstatus",
    trackRequested: "Angefordert",
    trackSent: "Gesendet",
    trackVerifying: "Prüfung",
    trackConfirmed: "Bestätigt",
  },
} as const;

export type Copy = (typeof text)[Locale];

/** Returns one of the two fixed local copy bundles without indexing by input. */
export function copyFor(locale: Locale): Copy {
  return locale === "de" ? text.de : text.en;
}

const loadingProblemCopy = (copy: Copy): readonly string[] => copy.loading;

const problemCopiers = new Map<ClientProblem, typeof loadingProblemCopy>([
  ["loading", loadingProblemCopy],
  ["empty", (copy) => copy.empty],
  ["offline", (copy) => copy.offline],
  ["session-expired", (copy) => copy.sessionExpired],
  ["authorization-denied", (copy) => copy.authorizationDenied],
  ["device-match-failed", (copy) => copy.deviceFailed],
  ["server", (copy) => copy.server],
  ["unknown", (copy) => copy.unknown],
]);

export function problemCopy(locale: Locale, problem: ClientProblem) {
  const copy = copyFor(locale);
  const copier = problemCopiers.get(problem);
  return copier ? copier(copy) : copy.unknown;
}

export function localeFor(language: string): Locale {
  return language.toLowerCase().startsWith("de") ? "de" : "en";
}
