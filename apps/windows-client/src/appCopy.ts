import type { ClientProblem } from "./models";

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
    deviceFailed: [
      "This device is not assigned",
      "Use the device assigned to your account or contact support.",
    ],
    server: [
      "Service unavailable",
      "The software service could not complete your request.",
    ],
    action: [
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
    deviceFailed: [
      "Dieses Gerät ist nicht zugeordnet",
      "Verwenden Sie ein zugeordnetes Gerät oder wenden Sie sich an den Support.",
    ],
    server: [
      "Dienst nicht verfügbar",
      "Der Softwaredienst konnte die Anfrage nicht abschließen.",
    ],
    action: [
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
  },
} as const;

export type Copy = (typeof text)[Locale];

export function problemCopy(locale: Locale, problem: ClientProblem) {
  const copy = text[locale];
  const mapping = {
    loading: copy.loading,
    empty: copy.empty,
    offline: copy.offline,
    "session-expired": copy.sessionExpired,
    "device-match-failed": copy.deviceFailed,
    server: copy.server,
    action: copy.action,
    unknown: copy.unknown,
  };
  return mapping[problem];
}

export function localeFor(language: string): Locale {
  return language.toLowerCase().startsWith("de") ? "de" : "en";
}
