export type Locale = "de" | "en";

type Copy = {
  locale: Locale;
  managedSoftware: string;
  assignedDevice: string;
  application: string;
  version: string;
  supportLink: string;
  trackRequested: string;
  trackSent: string;
  trackVerifying: string;
  trackConfirmed: string;
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
  verifyingUpdate: string;
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
    managedSoftware: "Approved software",
    assignedDevice: "Assigned device",
    application: "Application",
    version: "Version",
    supportLink: "Support",
    trackRequested: "Requested",
    trackSent: "Sent",
    trackVerifying: "Verifying",
    trackConfirmed: "Confirmed",
    compliant: "Compliant",
    softwareViews: "Software views",
    toolbarLabel: "Search and source",
    available: "Available",
    updates: "Updates",
    availableSummary:
      "Chosen for this fictional PC by a fictional organization.",
    updatesSummary: "Newer approved versions of software already on this PC.",
    search: "Search",
    searchPlaceholder: "Search software",
    source: "Source",
    allSources: "All sources",
    install: "Install",
    update: "Update",
    retry: "Retry",
    locked: "Locked for review",
    queued: "Queued",
    verifying: "Verifying installation",
    verifyingUpdate: "Verifying update",
    succeeded: "Succeeded",
    failed: "Failed",
    confirmTitle: "Confirm simulated action",
    confirmText:
      "Nothing is installed. The demo plays Requested, Verifying, Confirmed and resets on reload.",
    cancel: "Cancel",
    confirm: "Confirm",
    current: "Current",
    target: "Target",
    noResults: "No software matches the selected filters.",
    support: "Demo support details",
    supportText: "The fictional details IT would ask you for.",
    supportIp: "Documentation/test-only endpoint: 192.0.2.47",
    supportUser: "User",
    supportDevice: "Device",
    supportSerial: "Serial",
    supportWindows: "Windows",
    supportNetwork: "Network",
    demoNotice: "Interactive demo with synthetic catalog data only.",
    disclosure:
      "Synthetic data. No backend or credentials are used. Changes reset when this page reloads.",
  },
  de: {
    locale: "de",
    managedSoftware: "Freigegebene Software",
    assignedDevice: "Zugeordnetes Gerät",
    application: "Anwendung",
    version: "Version",
    supportLink: "Support",
    trackRequested: "Angefordert",
    trackSent: "Gesendet",
    trackVerifying: "Prüfung",
    trackConfirmed: "Bestätigt",
    compliant: "Konform",
    softwareViews: "Softwareansichten",
    toolbarLabel: "Suche und Quelle",
    available: "Verfügbar",
    updates: "Updates",
    availableSummary:
      "Für diesen fiktiven PC von einer fiktiven Organisation ausgewählt.",
    updatesSummary:
      "Neuere freigegebene Versionen bereits installierter Software.",
    search: "Suchen",
    searchPlaceholder: "Software suchen",
    source: "Quelle",
    allSources: "Alle Quellen",
    install: "Installieren",
    update: "Aktualisieren",
    retry: "Erneut versuchen",
    locked: "Für Prüfung gesperrt",
    queued: "Eingereiht",
    verifying: "Installation wird überprüft",
    verifyingUpdate: "Update wird überprüft",
    succeeded: "Erfolgreich",
    failed: "Fehlgeschlagen",
    confirmTitle: "Simulierte Aktion bestätigen",
    confirmText:
      "Es wird nichts installiert. Die Demo zeigt Angefordert, Prüfung, Bestätigt und setzt sich beim Neuladen zurück.",
    cancel: "Abbrechen",
    confirm: "Bestätigen",
    current: "Aktuell",
    target: "Ziel",
    noResults: "Keine Software entspricht den ausgewählten Filtern.",
    support: "Demo-Supportdetails",
    supportText: "Die fiktiven Angaben, nach denen die IT fragen würde.",
    supportIp: "Dokumentations-/Test-Endpunkt: 192.0.2.47",
    supportUser: "Benutzer",
    supportDevice: "Gerät",
    supportSerial: "Seriennummer",
    supportWindows: "Windows",
    supportNetwork: "Netzwerk",
    demoNotice:
      "Interaktive Demo mit ausschließlich synthetischen Katalogdaten.",
    disclosure:
      "Synthetische Daten. Es gibt kein Backend und keine Zugangsdaten. Änderungen werden beim Neuladen zurückgesetzt.",
  },
};

export function copyForBrowser(): Copy {
  return copies[
    navigator.language.toLowerCase().startsWith("de") ? "de" : "en"
  ];
}
