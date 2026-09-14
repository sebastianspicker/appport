import { useLayoutEffect, useRef } from "react";
import { copyFor, type Locale } from "../i18n/copy";
import { designCopyFor } from "../i18n/designCopy";
import { Status } from "../ui/Status";
import { Icon } from "../ui/Icon";
import { AppIcon } from "./AppIcon";
import { ActionSummary } from "./ActionSummary";
import { ActionControl } from "./ActionControl";
import type { AvailableApp } from "../native-bridge/types";
import type { Catalog } from "./model";
import type { View } from "./types";

export type CatalogTaskState = {
  application: AvailableApp;
  deviceName: string;
  submitted: boolean;
  originatingView: View | undefined;
  opener: HTMLElement;
};

export function CatalogTask({
  task,
  catalog,
  locale,
  onBack,
  onSubmit,
}: {
  task: CatalogTaskState;
  catalog: Catalog;
  locale: Locale;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus();
  }, [task.submitted]);
  const copy = copyFor(locale);
  const design = designCopyFor(locale);
  const application = task.application;
  const title = task.submitted
    ? submittedTitle(catalog, application.id, locale)
    : application.installedVersionId
      ? design.reviewUpdate
      : design.reviewInstall;
  return (
    <section className="catalog-task" aria-labelledby="task-title">
      <button className="task-back text-button" onClick={onBack}>
        ← {design.back}
      </button>
      <div className="task-body">
        <AppIcon
          appId={application.id}
          hasIcon={application.hasIcon}
          name={application.name}
          sessionKey={catalog.iconSession}
          catalogRevision={catalog.catalogRevision}
        />
        <div className="task-content">
          <h2 ref={heading} tabIndex={-1} id="task-title">
            {title}
          </h2>
          <p className="task-identity">{application.name}</p>
          <p>{application.description ?? copy.approvedForDevice}</p>
          <dl className="task-facts">
            <div>
              <dt>
                {task.submitted ? design.reviewedVersion : copy.targetVersion}
              </dt>
              <dd>{application.releasedVersionLabel ?? copy.available}</dd>
            </div>
            <div>
              <dt>{copy.forDevice}</dt>
              <dd>{task.deviceName}</dd>
            </div>
          </dl>
          <TaskRefreshState catalog={catalog} locale={locale} />
          {task.submitted ? (
            <TaskActionFeedback
              catalog={catalog}
              application={application}
              locale={locale}
            />
          ) : (
            <>
              <p>{design.permission}</p>
              <p className="task-warning">
                <Icon name="warning" size={16} />
                {copy.confirmationWarning}
              </p>
              <div className="task-actions">
                <button className="secondary" onClick={onBack}>
                  {copy.cancel}
                </button>
                <button
                  className="primary"
                  disabled={!canSubmitTask(catalog, application)}
                  onClick={onSubmit}
                >
                  {application.installedVersionId
                    ? design.requestUpdate
                    : design.requestInstall}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export function SuccessReceipt({
  task,
  locale,
  onDismiss,
  intent,
}: {
  intent: "install" | "update";
  task: CatalogTaskState;
  locale: Locale;
  onDismiss: () => void;
}) {
  const design = designCopyFor(locale);
  const receipt = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    receipt.current?.focus();
  }, []);
  return (
    <div className="success-receipt" role="status" ref={receipt} tabIndex={-1}>
      <span className="receipt-check">
        <Icon name="check" size={24} />
      </span>
      <div>
        <strong>
          {task.application.name} ·{" "}
          {intent === "update" ? design.updated : design.installed}
        </strong>
        <p>{design.receipt.replace("{device}", task.deviceName)}</p>
      </div>
      <button className="secondary" onClick={onDismiss}>
        {design.close}
      </button>
    </div>
  );
}

function allowsNewRequest(state: string | null | undefined) {
  return !state || state === "failed" || state === "cancelled";
}

function canSubmitTask(catalog: Catalog, application: AvailableApp) {
  const current = catalog.apps.find((app) => app.id === application.id);
  return (
    catalog.bootstrap?.writesEnabled === true &&
    catalog.phase === "ready" &&
    current?.releasedVersionId === application.releasedVersionId &&
    !catalog.busyApps.has(application.id) &&
    allowsNewRequest(catalog.actions.get(application.id)?.state) &&
    allowsNewRequest(current?.activeActionState)
  );
}

function TaskRefreshState({
  catalog,
  locale,
}: {
  catalog: Catalog;
  locale: Locale;
}) {
  if (
    catalog.phase === "ready" ||
    catalog.phase === "empty" ||
    catalog.phase === "loading"
  )
    return null;
  return (
    <Status
      problem={catalog.phase}
      locale={locale}
      retry={() => catalog.load(catalog.view, true, true)}
    />
  );
}

function submittedTitle(catalog: Catalog, appId: string, locale: Locale) {
  const action = catalog.actions.get(appId);
  if (action?.state !== "verifying") return designCopyFor(locale).task;
  return action.intent === "update"
    ? copyFor(locale).actionVerifyingUpdate
    : copyFor(locale).actionVerifyingInstall;
}

function TaskActionFeedback({
  catalog,
  application,
  locale,
}: {
  catalog: Catalog;
  application: AvailableApp;
  locale: Locale;
}) {
  const action = catalog.actions.get(application.id);
  const polling = catalog.polling.get(application.id);
  const failure = catalog.actionFailures.get(application.id);
  if (failure)
    return (
      <p role="alert" className="inline-error">
        {failure}
      </p>
    );
  return (
    <div className="task-status">
      {action && (
        <ActionSummary
          application={application}
          action={action}
          locale={locale}
          polling={polling}
          state={action.state}
        />
      )}
      {(!action || polling === "paused") && (
        <ActionControl
          application={application}
          busy={catalog.busyApps.has(application.id)}
          locale={locale}
          state={action?.state}
          onConfirm={() => {}}
          polling={polling}
          onResume={catalog.resumeAction}
          writesEnabled={false}
        />
      )}
    </div>
  );
}
