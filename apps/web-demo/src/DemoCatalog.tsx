import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { copyForBrowser } from "./copy";
import type { ActionState, DemoApplication, Source, View } from "./data";

export type SourceFilter = "all" | Source;

export function DemoCatalog({
  applications,
  copy,
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
  copy: ReturnType<typeof copyForBrowser>;
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
    <section className="content-pane">
      <header className="content-header">
        <div>
          <h1>{view === "updates" ? copy.updates : copy.available}</h1>
          <p>
            {view === "updates" ? copy.updatesSummary : copy.availableSummary}
          </p>
        </div>
        <section className="toolbar" aria-label={copy.toolbarLabel}>
          <label className="search-field">
            <Icon name="search" size={16} />
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
      </header>
      <section className="catalog-results" aria-live="polite">
        {applications.length > 0 ? (
          <div className="grid">
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
        ) : (
          <p className="empty-state">{copy.noResults}</p>
        )}
      </section>
      {supportPanel}
    </section>
  );
}

function DemoCard({
  application,
  copy,
  onConfirm,
  state,
}: {
  application: DemoApplication;
  copy: ReturnType<typeof copyForBrowser>;
  onConfirm: (application: DemoApplication, opener: HTMLButtonElement) => void;
  state: ActionState;
}) {
  const actionLabel =
    application.view === "updates" ? copy.update : copy.install;
  return (
    <article className="card">
      <div className="card-heading">
        <span className="app-icon placeholder" aria-hidden="true">
          {application.name.slice(0, 1)}
        </span>
        <div className="card-identity">
          <h2>{application.name}</h2>
          <p>
            {application.publisher}
            <span className="source-chip">
              {sourceLabel(application.source)}
            </span>
          </p>
        </div>
      </div>
      <p className="app-description">{application.description[copy.locale]}</p>
      <div className="version-rail">
        {application.currentVersion ? (
          <>
            <span>{copy.current}</span>
            <strong>{application.currentVersion}</strong>
            <span aria-hidden="true">→</span>
          </>
        ) : null}
        <span>{copy.target}</span>
        <strong>{application.targetVersion}</strong>
      </div>
      <DemoAction
        application={application}
        copy={copy}
        label={actionLabel}
        onConfirm={onConfirm}
        state={state}
      />
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
  copy: ReturnType<typeof copyForBrowser>;
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
      <DemoActionButton
        application={application}
        label={copy.retry}
        onConfirm={onConfirm}
        tone="secondary"
      />
    );
  if (state === "unknown")
    return (
      <div className="unknown-note" role="status">
        <Icon name="warning" size={15} />
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

function DemoProgress({
  application,
  copy,
  state,
}: {
  application: DemoApplication;
  copy: ReturnType<typeof copyForBrowser>;
  state: Exclude<ActionState, "available" | "failed" | "unknown">;
}) {
  const working = state !== "succeeded";
  const text =
    state === "queued"
      ? copy.queued
      : state === "verifying"
        ? copy.verifying
        : copy.succeeded;
  return (
    <div className="action-progress-wrap">
      <span
        className={`status-pill ${state === "succeeded" ? "success" : "working"}`}
      >
        {state === "succeeded" ? <Icon name="check" size={14} /> : null}
        {text}
      </span>
      {working ? (
        <div
          aria-label={`${application.name}: ${text}`}
          className="action-progress"
          role="progressbar"
        >
          <span />
        </div>
      ) : null}
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
