export type Locale = "de" | "en";

type Copy = {
  locale: Locale;
  managedSoftware: string;
  demoOnly: string;
  compliant: string;
  softwareViews: string;
  toolbarLabel: string;
  available: string;
  updates: string;
  availableSummary: string;
  updatesSummary: string;
  search: string;
  searchPlaceholder: string;
  source: string;
  allSources: string;
  install: string;
  update: string;
  retry: string;
  locked: string;
  queued: string;
  verifying: string;
  succeeded: string;
  failed: string;
  confirmTitle: string;
  confirmText: string;
  cancel: string;
  confirm: string;
  current: string;
  target: string;
  noResults: string;
  support: string;
  supportText: string;
  supportIp: string;
  supportUser: string;
  supportDevice: string;
  supportSerial: string;
  supportWindows: string;
  supportNetwork: string;
  demoNotice: string;
  disclosure: string;
};

const copies: Record<Locale, Copy> = {
  en: {
    locale: "en",
    managedSoftware: "Managed software",
    demoOnly: "Demo only",
    compliant: "Compliant",
    softwareViews: "Software views",
    toolbarLabel: "Search and source",
    available: "Available",
    updates: "Updates",
    availableSummary:
      "Software available to Demo User on this synthetic device.",
    updatesSummary:
      "Synthetic updates available for the installed demo software.",
    search: "Search",
    searchPlaceholder: "Search software",
    source: "Source",
    allSources: "All sources",
    install: "Install",
    update: "Update",
    retry: "Retry",
    locked: "Locked for review",
    queued: "Queued",
    verifying: "Verifying",
    succeeded: "Succeeded",
    failed: "Failed",
    confirmTitle: "Confirm simulated action",
    confirmText: "This only changes the in-memory demo state for DEMO-PC-047.",
    cancel: "Cancel",
    confirm: "Confirm",
    current: "Current",
    target: "Target",
    noResults: "No software matches the selected filters.",
    support: "Demo support details",
    supportText: "Static reference details for this interactive sample.",
    supportIp: "Documentation/test-only endpoint: 192.0.2.47",
    supportUser: "User",
    supportDevice: "Device",
    supportSerial: "Serial",
    supportWindows: "Windows",
    supportNetwork: "Network",
    demoNotice: "Interactive demo: synthetic catalog data only.",
    disclosure:
      "Synthetic data. No backend or credentials are used. Changes reset when this page reloads.",
  },
  de: {
    locale: "de",
    managedSoftware: "Verwaltete Software",
    demoOnly: "Nur Demo",
    compliant: "Konform",
    softwareViews: "Softwareansichten",
    toolbarLabel: "Suche und Quelle",
    available: "Verfügbar",
    updates: "Updates",
    availableSummary: "Software für Demo User auf diesem synthetischen Gerät.",
    updatesSummary: "Synthetische Updates für die installierte Demo-Software.",
    search: "Suchen",
    searchPlaceholder: "Software suchen",
    source: "Quelle",
    allSources: "Alle Quellen",
    install: "Installieren",
    update: "Aktualisieren",
    retry: "Erneut versuchen",
    locked: "Für Prüfung gesperrt",
    queued: "Eingereiht",
    verifying: "Wird geprüft",
    succeeded: "Erfolgreich",
    failed: "Fehlgeschlagen",
    confirmTitle: "Simulierte Aktion bestätigen",
    confirmText: "Dies ändert nur den flüchtigen Demo-Status für DEMO-PC-047.",
    cancel: "Abbrechen",
    confirm: "Bestätigen",
    current: "Aktuell",
    target: "Ziel",
    noResults: "Keine Software entspricht den ausgewählten Filtern.",
    support: "Demo-Supportdetails",
    supportText: "Statische Referenzdetails für dieses interaktive Beispiel.",
    supportIp: "Dokumentations-/Test-Endpunkt: 192.0.2.47",
    supportUser: "Benutzer",
    supportDevice: "Gerät",
    supportSerial: "Seriennummer",
    supportWindows: "Windows",
    supportNetwork: "Netzwerk",
    demoNotice: "Interaktive Demo: nur synthetische Katalogdaten.",
    disclosure:
      "Synthetische Daten. Es gibt kein Backend und keine Zugangsdaten. Änderungen werden beim Neuladen zurückgesetzt.",
  },
};

export function copyForBrowser(): Copy {
  return copies[
    navigator.language.toLowerCase().startsWith("de") ? "de" : "en"
  ];
}
