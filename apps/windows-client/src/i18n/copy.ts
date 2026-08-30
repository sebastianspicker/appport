import type { ClientProblem } from "../native-bridge/types";

export type Locale = "en" | "de";

export const text = {
  en: {
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
      "Use your personal, expiring Relution token. Appport cannot revoke it; revoke replaced or exposed tokens in your Relution profile.",
    apps: "Available",
    updates: "Updates",
    search: "Search",
    searchPlaceholder: "Search approved software",
    source: "Source",
    allSources: "All sources",
    noSearchResults: "No approved software matches your search.",
    loading: ["Loading this device", "Checking your approved software."],
    empty: ["Nothing to show", "There is no approved software in this view."],
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
    retry: "Try again",
    approved: "Approved software",
    approvedForDevice: "Approved for this device.",
    available: "Available",
    updateAvailable: "Update available",
    installedVersion: "Installed version",
    availableVersion: "Available version",
    install: "Install",
    update: "Update",
    readOnly: "Read-only candidate. Installation and updates are disabled.",
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
      "After confirmation, the result may be temporarily unknown. Do not submit the action again unless IT confirms it is safe.",
    backgroundCheckUnavailable:
      "Background update checks could not be registered. Keep Appport open to receive update status.",
    signOutIncomplete:
      "Sign-out is incomplete because this device could not delete its stored credential. Contact IT before using this shared device.",
    signOutPartial:
      "Signed out locally. Revoke the token in your Relution profile if it is no longer needed; some background cleanup did not complete.",
    signOutFailed:
      "Sign-out could not run. Your stored credential may still be present. Try again or contact IT.",
    support: "Support",
    supportSummary: "Device details and local support bundle",
    supportGuidance:
      "Only software assigned through Relution appears in Appport.",
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
  },
  de: {
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
      "Verwenden Sie Ihren persönlichen, ablaufenden Relution-Token. Appport kann ihn nicht widerrufen; widerrufen Sie ersetzte oder offengelegte Token in Ihrem Relution-Profil.",
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
      "Nichts vorhanden",
      "In dieser Ansicht ist keine Software vorhanden.",
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
    retry: "Erneut versuchen",
    approved: "Freigegebene Software",
    approvedForDevice: "Für dieses Gerät freigegeben.",
    available: "Verfügbar",
    updateAvailable: "Update verfügbar",
    installedVersion: "Installierte Version",
    availableVersion: "Verfügbare Version",
    install: "Installieren",
    update: "Aktualisieren",
    readOnly:
      "Schreibgeschützte Testversion. Installationen und Updates sind deaktiviert.",
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
      "Nach der Bestätigung kann das Ergebnis vorübergehend unbekannt sein. Starten Sie die Aktion nur dann erneut, wenn die IT dies bestätigt.",
    backgroundCheckUnavailable:
      "Hintergrundprüfungen für Updates konnten nicht registriert werden. Lassen Sie Appport geöffnet, um Update-Status zu erhalten.",
    signOutIncomplete:
      "Die Abmeldung ist unvollständig, weil dieses Gerät die gespeicherte Anmeldeinformation nicht löschen konnte. Wenden Sie sich vor der Nutzung dieses gemeinsam verwendeten Geräts an die IT.",
    signOutPartial:
      "Lokal abgemeldet. Widerrufen Sie den Token in Ihrem Relution-Profil, wenn er nicht mehr benötigt wird; ein Teil der Hintergrundbereinigung ist fehlgeschlagen.",
    signOutFailed:
      "Die Abmeldung konnte nicht ausgeführt werden. Die gespeicherte Anmeldeinformation kann noch vorhanden sein. Versuchen Sie es erneut oder wenden Sie sich an den Support.",
    support: "Support",
    supportSummary: "Gerätedetails und lokales Supportpaket",
    supportGuidance:
      "In Appport erscheint nur Software, die über Relution zugewiesen ist.",
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
