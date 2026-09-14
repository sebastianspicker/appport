export type Source = "winget" | "windows_msi" | "windows_exe";
export type View = "available" | "updates";
export type ActionState =
  | "available"
  | "failed"
  | "queued"
  | "verifying"
  | "succeeded"
  | "unknown";

export type DemoApplication = {
  id: string;
  name: string;
  publisher: string;
  description: { de: string; en: string };
  source: Source;
  view: View;
  currentVersion?: string;
  targetVersion: string;
  initialState: ActionState;
};

export const demoApplications: readonly DemoApplication[] = [
  {
    id: "drawpad",
    name: "Drawpad",
    publisher: "Northwind Studio",
    description: {
      en: "A focused sketching workspace approved for this demo device.",
      de: "Ein fokussierter Zeichenbereich für dieses Demo-Gerät.",
    },
    source: "winget",
    view: "available",
    targetVersion: "5.8.1",
    initialState: "available",
  },
  {
    id: "field-notes",
    name: "Field Notes",
    publisher: "Contoso Tools",
    description: {
      en: "Collect and organize project notes while working offline.",
      de: "Projektnotizen offline erfassen und organisieren.",
    },
    source: "windows_msi",
    view: "available",
    targetVersion: "3.4.0",
    initialState: "available",
  },
  {
    id: "image-lab",
    name: "Image Lab",
    publisher: "Fabrikam",
    description: {
      en: "A sample action that can be retried after a simulated failure.",
      de: "Eine Beispielaktion, die nach einem simulierten Fehler erneut versucht werden kann.",
    },
    source: "windows_exe",
    view: "available",
    targetVersion: "2.9.3",
    initialState: "failed",
  },
  {
    id: "archive-room",
    name: "Archive Room",
    publisher: "Adventure Works",
    description: {
      en: "This sample has an unresolved action and remains locked.",
      de: "Dieses Beispiel hat eine ungeklärte Aktion und bleibt gesperrt.",
    },
    source: "windows_exe",
    view: "available",
    targetVersion: "1.7.2",
    initialState: "unknown",
  },
  {
    id: "canvas-pro",
    name: "Canvas Pro",
    publisher: "Northwind Studio",
    description: {
      en: "An approved update for the installed demo version.",
      de: "Ein freigegebenes Update für die installierte Demo-Version.",
    },
    source: "winget",
    view: "updates",
    currentVersion: "8.2.0",
    targetVersion: "8.3.1",
    initialState: "available",
  },
  {
    id: "reporter",
    name: "Reporter",
    publisher: "Contoso Tools",
    description: {
      en: "A security and reliability update for the demo catalog.",
      de: "Ein Sicherheits- und Zuverlässigkeitsupdate für den Demo-Katalog.",
    },
    source: "windows_msi",
    view: "updates",
    currentVersion: "4.1.6",
    targetVersion: "4.2.0",
    initialState: "available",
  },
];
