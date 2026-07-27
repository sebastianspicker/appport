import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppAction,
  AppSource,
  AvailableApp,
  ClientProblem,
  InstalledApplication,
  NativeBootstrap,
} from "./models";
import { native } from "./native";

type View = "apps" | "updates" | "installed";
type Phase = "ready" | ClientProblem;
type Locale = "en" | "de";
type SourceFilter = "all" | AppSource;

const terminalStates = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);

const text = {
  en: {
    currentDevice: "Current device only",
    forDevice: "For this device",
    signIn: "Sign in",
    signOut: "Sign out",
    apps: "Apps",
    updates: "Updates",
    installed: "Installed",
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
    install: "Install",
    update: "Update",
    retryAction: "Retry",
    starting: "Starting…",
    status: "Status",
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
    signOutIncomplete: "Sign-out is incomplete because this device could not delete its stored credential. Contact IT before using this shared device.",
    signOutPartial:
      "Signed out locally, but remote revocation or background cleanup did not complete. Contact IT if this device may be at risk.",
    signOutFailed:
      "Sign-out could not run. Your stored credential may still be present. Try again or contact IT.",
  },
  de: {
    currentDevice: "Nur dieses Gerät",
    forDevice: "Für dieses Gerät",
    signIn: "Anmelden",
    signOut: "Abmelden",
    apps: "Apps",
    updates: "Updates",
    installed: "Installiert",
    search: "Suchen",
    searchPlaceholder: "Freigegebene Software suchen",
    source: "Quelle",
    allSources: "Alle Quellen",
    noSearchResults: "Keine freigegebene Software entspricht Ihrer Suche.",
    loading: ["Dieses Gerät wird geladen", "Ihre freigegebene Software wird geprüft."],
    empty: ["Nichts vorhanden", "In dieser Ansicht ist keine Software vorhanden."],
    offline: [
      "Sie sind offline",
      "Stellen Sie eine Internetverbindung her und versuchen Sie es erneut.",
    ],
    sessionExpired: ["Ihre Sitzung ist abgelaufen", "Melden Sie sich erneut an."],
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
    install: "Installieren",
    update: "Aktualisieren",
    retryAction: "Erneut versuchen",
    starting: "Wird gestartet…",
    status: "Status",
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
    signOutIncomplete: "Die Abmeldung ist unvollständig, weil dieses Gerät die gespeicherte Anmeldeinformation nicht löschen konnte. Wenden Sie sich vor der Nutzung dieses gemeinsam verwendeten Geräts an die IT.",
    signOutPartial:
      "Lokal abgemeldet, aber die Remote-Sitzung oder Hintergrundaufgabe konnte nicht vollständig bereinigt werden. Wenden Sie sich bei einem möglichen Risiko an die IT.",
    signOutFailed:
      "Die Abmeldung konnte nicht ausgeführt werden. Die gespeicherte Anmeldeinformation kann noch vorhanden sein. Versuchen Sie es erneut oder wenden Sie sich an die IT.",
  },
} as const;

function problemFor(error: unknown): ClientProblem {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case "OFFLINE": return "offline";
    case "SESSION_EXPIRED": return "session-expired";
    case "DEVICE_MATCH_FAILED": return "device-match-failed";
    case "SERVER": return "server";
    case "ACTION": return "action";
    default: return "unknown";
  }
}

function problemCopy(locale: Locale, problem: ClientProblem) {
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

export function App() {
  const locale: Locale = navigator.language.toLowerCase().startsWith("de")
    ? "de"
    : "en";
  const copy = text[locale];
  const mounted = useRef(true);
  const [view, setView] = useState<View>();
  const [bootstrap, setBootstrap] = useState<NativeBootstrap>();
  const [apps, setApps] = useState<AvailableApp[]>([]);
  const [installed, setInstalled] = useState<InstalledApplication[]>([]);
  const [actions, setActions] = useState<Record<string, AppAction>>({});
  const [phase, setPhase] = useState<Phase>("loading");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [busy, setBusy] = useState<string>();
  const [confirmation, setConfirmation] = useState<{
    application: AvailableApp;
    opener: HTMLElement;
  }>();
  const [signOutWarning, setSignOutWarning] = useState<string>();

  useEffect(() => {
    mounted.current = true;
    void native
      .initialView()
      .then(setView)
      .catch(() => setView("apps"));
    return () => {
      mounted.current = false;
    };
  }, []);

  async function load(activeView = view, showLoading = true) {
    if (!activeView) return;
    if (showLoading) setPhase("loading");
    try {
      const [nextBootstrap, list] = await Promise.all([
        native.bootstrap(),
        activeView === "installed"
          ? native.installed()
          : native.apps(activeView),
      ]);
      if (!mounted.current) return;
      setBootstrap(nextBootstrap);
      if (activeView === "installed") {
        setInstalled(list as InstalledApplication[]);
      } else {
        setApps(list as AvailableApp[]);
      }
      setPhase(list.length ? "ready" : "empty");
    } catch (error) {
      if (mounted.current) setPhase(problemFor(error));
    }
  }

  useEffect(() => {
    // View selection is the external trigger for the broker-backed list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (view) void load(view, false);
    // `load` intentionally follows the currently selected view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const rows = useMemo(() => {
    const entries = view === "installed" ? installed : apps;
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return entries.filter((application) => {
      const matchesQuery =
        !normalizedQuery ||
        application.name.toLocaleLowerCase(locale).includes(normalizedQuery);
      const matchesSource =
        sourceFilter === "all" || application.source === sourceFilter;
      return matchesQuery && matchesSource;
    });
  }, [view, apps, installed, query, sourceFilter, locale]);

  async function pollAction(action: AppAction) {
    let current = action;
    for (let attempt = 0; attempt < 150 && !terminalStates.has(current.state); attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      if (!mounted.current) return;
      current = await native.action(current.id);
      setActions((existing) => ({ ...existing, [current.appId]: current }));
    }
    if (!terminalStates.has(current.state)) {
      current = {
        ...current,
        state: "unknown",
        errorCode: "CLIENT_POLL_TIMEOUT",
        errorMessage: copy.unknownAction,
      };
      setActions((existing) => ({ ...existing, [current.appId]: current }));
    }
    if (current.state === "succeeded") await load();
  }

  async function action(application: AvailableApp) {
    setBusy(application.id);
    try {
      const started = await native.act(application.id);
      setActions((existing) => ({ ...existing, [application.id]: started }));
      setBusy(undefined);
      await pollAction(started);
    } catch {
      setPhase("action");
      setBusy(undefined);
    }
  }

  async function connect() {
    setPhase("loading");
    try {
      await native.beginConnect();
      await load();
    } catch (error) {
      setPhase(problemFor(error));
    }
  }

  async function signOut() {
    const outcome = await native.signOut().catch(() => undefined);
    if (!outcome) {
      setSignOutWarning(copy.signOutFailed);
      return;
    }
    if (outcome?.credentialDeletion === "failed") {
      setSignOutWarning(copy.signOutIncomplete);
      return;
    }
    setBootstrap(undefined);
    setApps([]);
    setInstalled([]);
    setActions({});
    setPhase("session-expired");
    setSignOutWarning(
      outcome.remoteRevocation === "failed" ||
        outcome.scheduledTaskRemoval === "failed"
        ? copy.signOutPartial
        : undefined,
    );
  }

  const showNoSearchResults =
    phase === "ready" &&
    (query.trim().length > 0 || sourceFilter !== "all") &&
    rows.length === 0;

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">RELUTION</p>
          <h1>Appport</h1>
          <p className="device">
            {bootstrap
              ? `${bootstrap.user.displayName} · ${bootstrap.device.name}`
              : copy.currentDevice}
          </p>
        </div>
        {bootstrap ? (
          <button className="secondary" onClick={() => void signOut()}>
            {copy.signOut}
          </button>
        ) : (
          <button className="secondary" onClick={() => void connect()}>
            {copy.signIn}
          </button>
        )}
      </header>

      <nav aria-label="Software views">
        {(["apps", "updates", "installed"] as View[]).map((item) => (
          <button
            key={item}
            className={view === item ? "active" : ""}
            onClick={() => {
              setPhase("loading");
              setView(item);
            }}
          >
            {item === "apps"
              ? copy.apps
              : item === "updates"
                ? `${copy.updates}${
                    bootstrap?.updateCount ? ` (${bootstrap.updateCount})` : ""
                  }`
                : copy.installed}
          </button>
        ))}
      </nav>

      <section className="toolbar">
        <label>
          {copy.search}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchPlaceholder}
          />
        </label>
        <label>
          {copy.source}
          <select
            value={sourceFilter}
            onChange={(event) =>
              setSourceFilter(event.target.value as SourceFilter)
            }
          >
            <option value="all">{copy.allSources}</option>
            <option value="winget">Winget</option>
            <option value="windows_msi">MSI</option>
            <option value="windows_exe">EXE</option>
          </select>
        </label>
        <span className="device-chip">{copy.forDevice}</span>
      </section>

      {showNoSearchResults ? (
        <p className="search-empty" role="status">
          {copy.noSearchResults}
        </p>
      ) : phase !== "ready" ? (
        <Status
          problem={phase}
          locale={locale}
          retry={phase === "session-expired" ? connect : load}
        />
      ) : (
        <section className="grid" aria-live="polite">
          {rows.map((application) =>
            "packageId" in application ? (
              <InstalledCard
                key={application.packageId}
                application={application}
                locale={locale}
              />
            ) : (
              <AppCard
                key={application.id}
                application={application}
                action={actions[application.id]}
                busy={busy === application.id}
                locale={locale}
                onConfirm={(selected, opener) => {
                  setConfirmation({ application: selected, opener });
                }}
              />
            ),
          )}
        </section>
      )}
      {signOutWarning && <p className="sign-out-warning" role="alert">{signOutWarning}</p>}
      {confirmation && (
        <ConfirmationDialog
          application={confirmation.application}
          deviceName={bootstrap?.device.name ?? copy.currentDevice}
          locale={locale}
          returnFocus={confirmation.opener}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => {
            const application = confirmation.application;
            setConfirmation(undefined);
            void action(application);
          }}
        />
      )}
    </main>
  );
}

function Status({
  problem,
  retry,
  locale,
}: {
  problem: ClientProblem;
  retry: () => Promise<void>;
  locale: Locale;
}) {
  const copy = text[locale];
  const [title, body] = problemCopy(locale, problem);
  const canRetry = !["loading", "empty", "device-match-failed"].includes(problem);
  return (
    <section className="state" role={problem === "loading" ? "status" : "alert"}>
      <h2>{title}</h2>
      <p>{body}</p>
      {canRetry && (
        <button onClick={() => void retry()}>
          {problem === "session-expired" ? copy.signIn : copy.retry}
        </button>
      )}
    </section>
  );
}

function AppIcon({ appId, name }: { appId: string; name: string }) {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    let active = true;
    void native
      .icon(appId)
      .then((value) => {
        if (active && value) setSource(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [appId]);
  return source ? (
    // The image is a bounded in-memory data URL returned by the Rust broker adapter.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="app-icon" src={source} alt="" />
  ) : (
    <span className="app-icon placeholder" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function AppCard({
  application,
  action,
  busy,
  locale,
  onConfirm,
}: {
  application: AvailableApp;
  action?: AppAction;
  busy: boolean;
  locale: Locale;
  onConfirm: (application: AvailableApp, opener: HTMLElement) => void;
}) {
  const copy = text[locale];
  const state = action?.state ?? application.activeActionState;
  const failed = state === "failed" || state === "cancelled";
  const unknown = state === "unknown";
  const active = Boolean(state && !terminalStates.has(state));
  const intent = application.installedVersionId ? "update" : "install";
  return (
    <article className="card">
      <div className="card-heading">
        <AppIcon appId={application.id} name={application.name} />
        <div>
          <p className="eyebrow">{application.publisher ?? copy.approved}</p>
          <h2>{application.name}</h2>
        </div>
      </div>
      <p>{application.description ?? copy.approvedForDevice}</p>
      <small>
        {state
          ? `${copy.status}: ${state}`
          : application.releasedVersionLabel ?? copy.available}
      </small>
      {unknown && (
        <p className="unknown-action" role="alert">
          {copy.unknownAction} <code>{action?.id ?? application.activeActionId}</code>
        </p>
      )}
      {application.installState !== "installed" && !unknown && (
        <button
          disabled={busy || active}
          onClick={(event) => onConfirm(application, event.currentTarget)}
        >
          {busy
            ? copy.starting
            : failed
              ? copy.retryAction
              : intent === "install"
                ? copy.install
                : copy.update}
        </button>
      )}
    </article>
  );
}

function ConfirmationDialog({
  application,
  deviceName,
  locale,
  returnFocus,
  onCancel,
  onConfirm,
}: {
  application: AvailableApp;
  deviceName: string;
  locale: Locale;
  returnFocus: HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = text[locale];
  const dialogRef = useRef<HTMLElement>(null);
  const intent = application.installedVersionId
    ? copy.confirmUpdate
    : copy.confirmInstall;
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      returnFocus?.focus();
    };
  }, [onCancel, returnFocus]);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="confirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-warning"
      >
        <h2 id="confirmation-title">
          {copy.confirmAction.replace("{intent}", intent)}
        </h2>
        <dl>
          <div>
            <dt>App</dt>
            <dd>{application.name}</dd>
          </div>
          <div>
            <dt>{copy.targetVersion}</dt>
            <dd>{application.releasedVersionLabel ?? copy.available}</dd>
          </div>
          <div>
            <dt>{copy.forDevice}</dt>
            <dd>{deviceName}</dd>
          </div>
        </dl>
        <p id="confirmation-warning" className="unknown-action">
          {copy.confirmationWarning}
        </p>
        <div className="dialog-actions">
          <button className="secondary" autoFocus onClick={onCancel}>
            {copy.cancel}
          </button>
          <button onClick={onConfirm}>{copy.confirm}</button>
        </div>
      </section>
    </div>
  );
}

function InstalledCard({
  application,
  locale,
}: {
  application: InstalledApplication;
  locale: Locale;
}) {
  const copy = text[locale];
  return (
    <article className="card">
      <div className="card-heading">
        {application.appId && (
          <AppIcon appId={application.appId} name={application.name} />
        )}
        <h2>{application.name}</h2>
      </div>
      <p>{application.version}</p>
      <small>
        {application.updateAvailable ? copy.updateAvailable : copy.installed}
      </small>
    </article>
  );
}
