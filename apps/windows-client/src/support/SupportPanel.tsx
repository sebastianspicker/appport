import { useEffect, useRef } from "react";
import { copyFor, type Copy, type Locale } from "../i18n/copy";
import type { NativeBootstrap } from "../native-bridge/types";
import { SupportConfirmationDialog } from "./SupportConfirmationDialog";
import { SupportDetailsList } from "./SupportDetails";
import { useSupportWorkflow } from "./useSupportWorkflow";

export function SupportPanel({
  bootstrap,
  locale,
  active = true,
}: {
  bootstrap: NativeBootstrap;
  locale: Locale;
  active?: boolean;
}) {
  const copy = copyFor(locale);
  const generateButtonRef = useRef<HTMLButtonElement>(null);
  const workflow = useSupportWorkflow(bootstrap, locale);
  const { loadDetails } = workflow;
  useEffect(() => {
    if (active) void loadDetails().catch(() => {});
  }, [active, loadDetails, bootstrap.user.displayName, bootstrap.device.name]);
  const busy = workflow.isGenerating || workflow.isLoading;
  return (
    <section className="support-panel" aria-label={copy.support}>
      <section
        className="support-device-section"
        aria-labelledby="device-details-title"
        aria-busy={workflow.isLoading}
      >
        <header className="support-section-header">
          <h2 id="device-details-title">{copy.deviceDetails}</h2>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void workflow.copyDetails()}
          >
            {copy.copyDeviceDetails}
          </button>
        </header>
        {workflow.visibleDetails && (
          <SupportDetailsList copy={copy} details={workflow.visibleDetails} />
        )}
        {!workflow.visibleDetails && !workflow.isLoading && (
          <button
            className="secondary"
            onClick={() => void loadDetails(true).catch(() => {})}
          >
            {copy.retry}
          </button>
        )}
      </section>
      <section
        className="support-bundle-section"
        tabIndex={-1}
        data-focus-return
        aria-labelledby="support-bundle-title"
      >
        <h2 id="support-bundle-title">{copy.shareWithIT}</h2>
        <p>{copy.supportConfirmDescription}</p>
        <div className="support-actions">
          <button
            ref={generateButtonRef}
            className="primary"
            disabled={busy}
            onClick={() =>
              void workflow.requestBundle(generateButtonRef.current)
            }
          >
            {copy.generateSupportBundle}
          </button>
          <button
            className="secondary"
            disabled={workflow.isGenerating}
            onClick={() => void workflow.openFolder()}
          >
            {copy.openSupportFolder}
          </button>
        </div>
      </section>
      <SupportFeedback copy={copy} workflow={workflow} />
      <p className="support-guidance">{copy.supportGuidance}</p>
      {active && workflow.confirming && workflow.visibleDetails && (
        <SupportConfirmationDialog
          copy={copy}
          details={workflow.visibleDetails}
          onClose={workflow.closeConfirmation}
          onConfirm={() => void workflow.generateBundle()}
          opener={workflow.opener}
        />
      )}
    </section>
  );
}

function SupportFeedback({
  copy,
  workflow,
}: {
  copy: Copy;
  workflow: ReturnType<typeof useSupportWorkflow>;
}) {
  return (
    <>
      {workflow.status && (
        <p className="support-status" role="status" aria-live="polite">
          {workflow.status}
        </p>
      )}
      {workflow.bundle && workflow.bundle.warnings.length > 0 && (
        <p className="support-warning" role="status">
          {copy.supportWarnings.replace(
            "{count}",
            String(workflow.bundle.warnings.length),
          )}
        </p>
      )}
      {workflow.error && (
        <p className="support-error" role="alert">
          {workflow.error}
        </p>
      )}
    </>
  );
}
