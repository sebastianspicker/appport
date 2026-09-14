import { useEffect, useMemo, useRef, useState } from "react";
import { copyForBrowser } from "./copy";
import { DemoCatalog, type SourceFilter } from "./DemoCatalog";
import { DemoConfirmationDialog } from "./DemoConfirmationDialog";
import { DemoNavigation } from "./DemoNavigation";
import { DemoSupport } from "./DemoSupport";
import {
  demoApplications,
  type ActionState,
  type DemoApplication,
  type View,
} from "./data";
import { Icon } from "./Icon";

type PendingAction = {
  application: DemoApplication;
  opener: HTMLButtonElement;
};
const transitionDelayMs = 700;
const successDelayMs = 2_100;
const completionDelayMs = 3_000;

export function App() {
  const copy = copyForBrowser();
  const [view, setView] = useState<View>("available");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [states, setStates] = useState<Record<string, ActionState>>(() =>
    Object.fromEntries(
      demoApplications.map((application) => [
        application.id,
        application.initialState,
      ]),
    ),
  );
  const [completed, setCompleted] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pending, setPending] = useState<PendingAction>();
  const timers = useRef<number[]>([]);
  useEffect(() => {
    document.documentElement.lang = copy.locale;
  }, [copy.locale]);
  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );
  const counts = useMemo(() => countApplications(completed), [completed]);
  const visibleApplications = useMemo(
    () => filterApplications(view, query, source, completed),
    [completed, query, source, view],
  );
  const changeView = (next: View) => {
    setView(next);
    setQuery("");
    setSource("all");
  };
  const startAction = (application: DemoApplication) => {
    setPending(undefined);
    setStates((current) => ({ ...current, [application.id]: "queued" }));
    scheduleAction(timers.current, application.id, setStates, setCompleted);
  };
  return (
    <div className="demo-frame" data-demo-build="appport-synthetic-demo">
      <div className="demo-notice" role="status">
        <Icon name="warning" size={16} />
        <strong>{copy.demoNotice}</strong>
        <span>{copy.disclosure}</span>
      </div>
      <main className="app-shell">
        <DemoNavigation
          copy={copy}
          counts={counts}
          view={view}
          onViewChange={changeView}
        />
        <DemoCatalog
          applications={visibleApplications}
          copy={copy}
          query={query}
          source={source}
          states={states}
          supportPanel={<DemoSupport copy={copy} />}
          view={view}
          onConfirm={(application, opener) =>
            setPending({ application, opener })
          }
          onQueryChange={setQuery}
          onSourceChange={setSource}
        />
        {pending && (
          <DemoConfirmationDialog
            application={pending.application}
            copy={copy}
            onCancel={() => setPending(undefined)}
            onConfirm={() => startAction(pending.application)}
            returnFocus={pending.opener}
          />
        )}
      </main>
    </div>
  );
}

function countApplications(completed: ReadonlySet<string>) {
  return {
    available: demoApplications.filter(
      (application) =>
        application.view === "available" && !completed.has(application.id),
    ).length,
    updates: demoApplications.filter(
      (application) =>
        application.view === "updates" && !completed.has(application.id),
    ).length,
  };
}
function filterApplications(
  view: View,
  query: string,
  source: SourceFilter,
  completed: ReadonlySet<string>,
) {
  const normalized = query.trim().toLocaleLowerCase();
  return demoApplications.filter(
    (application) =>
      application.view === view &&
      !completed.has(application.id) &&
      (source === "all" || application.source === source) &&
      (!normalized ||
        application.name.toLocaleLowerCase().includes(normalized) ||
        application.publisher.toLocaleLowerCase().includes(normalized)),
  );
}
function scheduleAction(
  timers: number[],
  id: string,
  setStates: React.Dispatch<React.SetStateAction<Record<string, ActionState>>>,
  setCompleted: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>,
) {
  timers.push(
    window.setTimeout(
      () => setStates((current) => ({ ...current, [id]: "verifying" })),
      transitionDelayMs,
    ),
    window.setTimeout(
      () => setStates((current) => ({ ...current, [id]: "succeeded" })),
      successDelayMs,
    ),
    window.setTimeout(
      () => setCompleted((current) => new Set(current).add(id)),
      completionDelayMs,
    ),
  );
}
