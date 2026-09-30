import { useRef, useState, type ReactNode } from "react";
import { CatalogNavigation } from "./CatalogNavigation";
import { CatalogResults } from "./CatalogResults";
import { copyFor, type Locale } from "../i18n/copy";
import { Icon } from "../ui/Icon";
import type { ConfirmationHandler } from "./confirmation";
import type { Catalog } from "./model";
import { CatalogToolbar } from "./CatalogToolbar";
import {
  CatalogTask,
  SuccessReceipt,
  type CatalogTaskState,
} from "./CatalogTask";

type CatalogPageProps = {
  catalog: Catalog;
  locale: Locale;
  sessionControls: ReactNode;
  sessionWarning: string | undefined;
  supportPanel: (active: boolean) => ReactNode;
};

export function CatalogPage(props: CatalogPageProps) {
  if (!props.catalog.bootstrap)
    return (
      <main className="signed-out-shell">
        {props.sessionControls}
        {props.sessionWarning && (
          <SignOutWarning message={props.sessionWarning} />
        )}
      </main>
    );
  return <CatalogWorkspace {...props} />;
}

function CatalogWorkspace({
  catalog,
  locale,
  sessionControls,
  sessionWarning,
  supportPanel,
}: CatalogPageProps) {
  const copy = copyFor(locale);
  const [supportOpen, setSupportOpen] = useState(false);
  const [task, setTask] = useScopedTask(catalog);
  const content = useRef<HTMLElement>(null);
  const focusContent = () => {
    requestAnimationFrame(() => content.current?.focus());
  };
  const back = () => {
    const opener = task?.opener;
    const appId = task?.application.id;
    setTask(undefined);
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus();
      else {
        const trigger = Array.from(
          content.current?.querySelectorAll<HTMLButtonElement>(
            "[data-application-id]",
          ) ?? [],
        ).find((button) => button.dataset.applicationId === appId);
        (trigger ?? content.current)?.focus();
      }
    });
  };
  const onConfirm: ConfirmationHandler = (request) => {
    const resolved =
      typeof request === "function" ? request(undefined) : request;
    if (resolved)
      setTask({
        ...resolved,
        deviceName: catalog.bootstrap?.device.name ?? copy.currentDevice,
        submitted: false,
        originatingView: catalog.view,
      });
  };
  const completed = isTaskComplete(task, catalog);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {copy.skipToContent}
      </a>
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <strong>{copy.appTitle}</strong>
        </div>
        <div className="header-actions">
          {sessionControls}
          <span aria-hidden="true">·</span>
          <button
            className="support-link text-button"
            aria-current={supportOpen ? "page" : undefined}
            onClick={() => {
              setSupportOpen(true);
              if (!task?.submitted) setTask(undefined);
              focusContent();
            }}
          >
            {copy.support}
          </button>
        </div>
      </header>
      <main
        className="content-pane"
        id="main-content"
        ref={content}
        tabIndex={-1}
      >
        <header className="content-header">
          <p className="current-device">
            <strong>{catalog.bootstrap?.device.name}</strong>
            <span>· {copy.assignedDevice}</span>
          </p>
          <h1>{supportOpen ? copy.support : copy.software}</h1>
          <p>{supportOpen ? copy.supportSummary : copy.summary}</p>
        </header>
        <div className="catalog-taskbar">
          <CatalogNavigation
            bootstrap={catalog.bootstrap}
            locale={locale}
            view={supportOpen ? undefined : catalog.view}
            onSelect={(view) => {
              setSupportOpen(false);
              if (!task?.submitted) setTask(undefined);
              focusContent();
              if (view !== catalog.view) catalog.selectView(view);
            }}
          />
          <button
            className="refresh-button text-button"
            disabled={catalog.phase === "loading"}
            onClick={() => {
              if (!task?.submitted) setTask(undefined);
              void catalog.load(catalog.view, true, true);
            }}
          >
            <Icon name="updates" size={24} />
            {copy.refresh}
          </button>
        </div>
        <div hidden={supportOpen}>
          <CatalogBody
            catalog={catalog}
            locale={locale}
            task={task}
            completed={completed}
            back={back}
            onConfirm={onConfirm}
            onSubmit={() => {
              if (!task || task.submitted) return;
              setTask({ ...task, submitted: true });
              void catalog.startAction(task.application);
            }}
          />
        </div>
        <div hidden={!supportOpen}>{supportPanel(supportOpen)}</div>
        {sessionWarning && <SignOutWarning message={sessionWarning} />}
      </main>
    </div>
  );
}

function SignOutWarning({ message }: { message: string }) {
  return (
    <p className="sign-out-warning" role="alert">
      <Icon name="warning" size={16} />
      {message}
    </p>
  );
}

function isTaskComplete(task: CatalogTaskState | undefined, catalog: Catalog) {
  if (!task?.submitted || task.originatingView !== catalog.view) return false;
  return (
    catalog.actions.get(task.application.id)?.state === "succeeded" &&
    (catalog.phase === "ready" || catalog.phase === "empty") &&
    !catalog.apps.some((app) => app.id === task.application.id)
  );
}

function CatalogBody({
  catalog,
  locale,
  task,
  completed,
  back,
  onConfirm,
  onSubmit,
}: {
  catalog: Catalog;
  locale: Locale;
  task: CatalogTaskState | undefined;
  completed: boolean;
  back: () => void;
  onConfirm: ConfirmationHandler;
  onSubmit: () => void;
}) {
  const copy = copyFor(locale);
  return (
    <>
      {!catalog.bootstrap?.writesEnabled && (
        <p className="catalog-notice" role="note">
          <Icon name="support" size={18} />
          {copy.readOnly}
        </p>
      )}
      {task && !completed ? (
        <CatalogTask
          task={task}
          catalog={catalog}
          locale={locale}
          onBack={back}
          onSubmit={onSubmit}
        />
      ) : (
        <>
          {task && completed && (
            <SuccessReceipt
              task={task}
              intent={catalog.actions.get(task.application.id)!.intent}
              locale={locale}
              onDismiss={back}
            />
          )}
          <CatalogToolbar catalog={catalog} locale={locale} />
          <div className="catalog-columns" aria-hidden="true">
            <span>{copy.application}</span>
            <span>{copy.version}</span>
            <span />
          </div>
          <CatalogResults
            catalog={catalog}
            locale={locale}
            onConfirm={onConfirm}
          />
          <p className="catalog-help">
            <Icon name="support" size={18} />
            {copy.softwareMissing} {copy.supportGuidance}
          </p>
        </>
      )}
    </>
  );
}

function useScopedTask(catalog: Catalog) {
  const currentScope = `${catalog.iconSession}:${catalog.bootstrap?.device.name}`;
  const [scope, setScope] = useState(currentScope);
  const [task, setTask] = useState<CatalogTaskState>();
  if (scope !== currentScope) {
    setScope(currentScope);
    setTask(undefined);
  } else if (task && !task.submitted && task.originatingView !== catalog.view) {
    setTask(undefined);
  }
  return [task, setTask] as const;
}
