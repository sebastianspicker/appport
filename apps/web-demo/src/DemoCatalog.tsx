import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { copyForBrowser } from "./copy";
import type { ActionState, DemoApplication, Source, View } from "./data";

export type SourceFilter = "all" | Source;
type Copy = ReturnType<typeof copyForBrowser>;

export function DemoCatalog({
  applications,
  copy,
  navigation,
  query,
  source,
  states,
  supportPanel,
  view,
  onConfirm,
  onQueryChange,
  onSourceChange,
}: {
  applications: readonly DemoApplication[];
  copy: Copy;
  navigation: ReactNode;
  query: string;
  source: SourceFilter;
  states: Record<string, ActionState>;
  supportPanel: ReactNode;
  view: View;
  onConfirm: (application: DemoApplication, opener: HTMLButtonElement) => void;
  onQueryChange: (value: string) => void;
  onSourceChange: (source: SourceFilter) => void;
}) {
  return (
    <>
      <header className="content-header">
        <h1>{copy.managedSoftware}</h1>
        <p>
          {view === "updates" ? copy.updatesSummary : copy.availableSummary}
        </p>
      </header>
      <div className="catalog-taskbar">{navigation}</div>
      <section className="toolbar" aria-label={copy.toolbarLabel}>
        <label className="search-field">
          <Icon name="search" size={18} />
          <input
            aria-label={copy.searchPlaceholder}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={copy.searchPlaceholder}
            value={query}
          />
        </label>
        <label className="source-field">
          <span className="visually-hidden">{copy.source}</span>
          <select
            aria-label={copy.source}
            onChange={(event) =>
              onSourceChange(event.target.value as SourceFilter)
            }
            value={source}
          >
            <option value="all">{copy.allSources}</option>
            <option value="winget">Winget</option>
            <option value="windows_msi">MSI</option>
            <option value="windows_exe">EXE</option>
          </select>
        </label>
      </section>
      <section className="catalog-results" aria-live="polite">
        {applications.length > 0 ? (
          <>
            <div className="catalog-columns" aria-hidden="true">
              <span>{copy.application}</span>
              <span>{copy.source}</span>
              <span>{copy.version}</span>
              <span />
            </div>
            <div className="catalog-list">
              {applications.map((application) => (
                <DemoCard
                  application={application}
                  copy={copy}
                  key={application.id}
                  onConfirm={onConfirm}
                  state={states[application.id] ?? "available"}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="empty-state">{copy.noResults}</p>
        )}
      </section>
      {supportPanel}
    </>
  );
}

function DemoCard({
  application,
  copy,
  onConfirm,
  state,
}: {
  application: DemoApplication;
  copy: Copy;
  onConfirm: (application: DemoApplication, opener: HTMLButtonElement) => void;
  state: ActionState;
}) {
  const actionLabel =
    application.view === "updates" ? copy.update : copy.install;
  return (
    <article className="card">
      <div className="app-identity">
        <span className="app-icon placeholder" aria-hidden="true">
          {application.name.slice(0, 1)}
        </span>
        <div className="card-identity">
          <h2>{application.name}</h2>
          <p className="app-publisher">
            {application.publisher}
            <span className="publisher-source">
              {" · "}
              {sourceLabel(application.source)}
            </span>
          </p>
          <p className="app-description">
            {application.description[copy.locale]}
          </p>
        </div>
      </div>
      <span className="row-source">{sourceLabel(application.source)}</span>
      <p className="row-version">
        {application.currentVersion ? (
          <>
            <span className="visually-hidden">{copy.current} </span>
            <span className="version-from">{application.currentVersion}</span>
            <span aria-hidden="true"> → </span>
          </>
        ) : null}
        <span className="visually-hidden">{copy.target} </span>
        <span
          className={`version-to${application.currentVersion ? " changed" : ""}`}
        >
          {application.targetVersion}
        </span>
      </p>
      <div className="row-action">
        <DemoAction
          application={application}
          copy={copy}
          label={actionLabel}
          onConfirm={onConfirm}
          state={state}
        />
      </div>
    </article>
  );
}

function DemoAction({
  application,
  copy,
  label,
  onConfirm,
  state,
}: {
  application: DemoApplication;
  copy: Copy;
  label: string;
  onConfirm: (application: DemoApplication, opener: HTMLButtonElement) => void;
  state: ActionState;
}) {
  if (state === "available")
    return (
      <DemoActionButton
        application={application}
        label={label}
        onConfirm={onConfirm}
        tone="primary"
      />
    );
  if (state === "failed")
    return (
      <>
        <span className="status-pill danger">
          <Icon name="error" size={14} />
          {copy.failed}
        </span>
        <DemoActionButton
          application={application}
          label={copy.retry}
          onConfirm={onConfirm}
          tone="secondary"
        />
      </>
    );
  if (state === "unknown")
    return (
      <div className="unknown-note" role="status">
        <Icon name="warning" size={16} />
        <span>{copy.locked}</span>
      </div>
    );
  return <DemoProgress application={application} copy={copy} state={state} />;
}

function DemoActionButton({
  application,
  label,
  onConfirm,
  tone,
}: {
  application: DemoApplication;
  label: string;
  onConfirm: (application: DemoApplication, opener: HTMLButtonElement) => void;
  tone: "primary" | "secondary";
}) {
  return (
    <button
      className={`action-button ${tone}`}
      onClick={(event) => onConfirm(application, event.currentTarget)}
    >
      {label}
    </button>
  );
}

/** The same four-stage request track as the Windows client, simulated. */
function DemoProgress({
  application,
  copy,
  state,
}: {
  application: DemoApplication;
  copy: Copy;
  state: Exclude<ActionState, "available" | "failed" | "unknown">;
}) {
  const working = state !== "succeeded";
  const text =
    state === "queued"
      ? copy.queued
      : state === "verifying"
        ? application.view === "updates"
          ? copy.verifyingUpdate
          : copy.verifying
        : copy.succeeded;
  const reached = state === "queued" ? 0 : state === "verifying" ? 2 : 4;
  const steps = [
    copy.trackRequested,
    copy.trackSent,
    copy.trackVerifying,
    copy.trackConfirmed,
  ];
  return (
    <div className="action-progress-wrap">
      <span
        className={`status-pill ${state === "succeeded" ? "success" : "working"}`}
      >
        {state === "succeeded" ? <Icon name="check" size={14} /> : null}
        {text}
      </span>
      <span
        className="request-track"
        {...(working && {
          "aria-label": `${application.name}: ${text}`,
          "aria-valuetext": steps[reached],
          role: "progressbar",
        })}
      >
        {steps.map((step, index) => (
          <i
            key={step}
            className={
              index < reached ? "done" : index === reached ? "current" : ""
            }
          >
            <span className="track-label">{step}</span>
          </i>
        ))}
      </span>
    </div>
  );
}

function sourceLabel(source: Source) {
  return source === "windows_msi"
    ? "MSI"
    : source === "windows_exe"
      ? "EXE"
      : "Winget";
}
