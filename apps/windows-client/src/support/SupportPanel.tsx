import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyFor, type Locale } from "../i18n/copy";
import { handleDialogKeyDown } from "../ui/dialogFocus";
import type {
  NativeBootstrap,
  SupportBundleResult,
  SupportDetails,
} from "../native-bridge/types";
import { native } from "../native-bridge/native";

type DetailsForIdentity = { identity: string; value: SupportDetails };

export function SupportPanel({
  bootstrap,
  locale,
}: {
  bootstrap: NativeBootstrap;
  locale: Locale;
}) {
  const copy = copyFor(locale);
  const identity = `${bootstrap.user.displayName}\u0000${bootstrap.device.name}`;
  const identityRef = useRef(identity);
  const detailsRef = useRef<DetailsForIdentity | null>(null);
  const attemptedIdentityRef = useRef<string | null>(null);
  const pendingRef = useRef<
    { identity: string; request: Promise<SupportDetails> } | undefined
  >(undefined);
  const generatingRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const generateButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [details, setDetails] = useState<DetailsForIdentity | null>(null);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [bundle, setBundle] = useState<SupportBundleResult>();
  const [confirming, setConfirming] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  identityRef.current = identity;
  const visibleDetails =
    details?.identity === identity ? details.value : undefined;

  useEffect(() => {
    detailsRef.current = null;
    attemptedIdentityRef.current = null;
    pendingRef.current = undefined;
    generatingRef.current = false;
    setDetails(null);
    setStatus(undefined);
    setError(undefined);
    setBundle(undefined);
    setConfirming(false);
    setIsGenerating(false);
  }, [identity]);

  const loadDetails = useCallback(
    async (explicit = false): Promise<SupportDetails | undefined> => {
      const requestedIdentity = identityRef.current;
      const cached = detailsRef.current;
      if (cached?.identity === requestedIdentity) return cached.value;
      if (!explicit && attemptedIdentityRef.current === requestedIdentity) {
        return undefined;
      }
      const pending = pendingRef.current;
      if (pending?.identity === requestedIdentity) return pending.request;

      attemptedIdentityRef.current = requestedIdentity;
      setError(undefined);
      setStatus(copy.supportLoading);
      const request = native
        .supportDetails()
        .then((value) => {
          if (identityRef.current === requestedIdentity) {
            const next = { identity: requestedIdentity, value };
            detailsRef.current = next;
            setDetails(next);
            setStatus(undefined);
          }
          return value;
        })
        .catch((reason: unknown) => {
          if (identityRef.current === requestedIdentity) {
            setStatus(undefined);
            setError(copy.supportLoadFailed);
          }
          throw reason;
        })
        .finally(() => {
          if (pendingRef.current?.request === request) {
            pendingRef.current = undefined;
          }
        });
      pendingRef.current = { identity: requestedIdentity, request };
      return request;
    },
    [copy.supportLoadFailed, copy.supportLoading],
  );

  const closeConfirmation = useCallback(() => setConfirming(false), []);

  useEffect(() => {
    if (!confirming) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      handleDialogKeyDown(event, dialog, closeConfirmation);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (dialog.open) dialog.close();
      openerRef.current?.focus();
    };
  }, [closeConfirmation, confirming]);

  async function copyDetails() {
    const requestedIdentity = identityRef.current;
    try {
      const value = await loadDetails(true);
      if (!value || identityRef.current !== requestedIdentity) return;
      await writeText(formatDetails(copy, value));
      if (identityRef.current === requestedIdentity) {
        setError(undefined);
        setStatus(copy.supportCopied);
      }
    } catch {
      if (identityRef.current === requestedIdentity) {
        setStatus(undefined);
        setError(copy.supportCopyFailed);
      }
    }
  }

  async function requestBundle() {
    const requestedIdentity = identityRef.current;
    openerRef.current = generateButtonRef.current;
    // A native details refresh creates the single-use confirmation binding for
    // this bundle attempt. Keep the last values visible while it completes.
    detailsRef.current = null;
    attemptedIdentityRef.current = null;
    try {
      const value = await loadDetails(true);
      if (value && identityRef.current === requestedIdentity)
        setConfirming(true);
    } catch {
      // loadDetails has already supplied the localized error.
    }
  }

  async function generateBundle() {
    if (generatingRef.current) return;
    generatingRef.current = true;
    const requestedIdentity = identityRef.current;
    closeConfirmation();
    setError(undefined);
    setStatus(copy.supportGenerating);
    setIsGenerating(true);
    try {
      const result = await native.generateSupportBundle(true);
      if (identityRef.current === requestedIdentity) {
        setBundle(result);
        setStatus(
          copy.supportBundleCreated
            .replace("{name}", result.bundleFileName)
            .replace("{size}", formatBytes(locale, result.bytes)),
        );
      }
    } catch {
      if (identityRef.current === requestedIdentity) {
        setStatus(undefined);
        setError(copy.supportGenerationFailed);
      }
    } finally {
      generatingRef.current = false;
      if (identityRef.current === requestedIdentity) setIsGenerating(false);
    }
  }

  async function openFolder() {
    setError(undefined);
    try {
      await native.openSupportFolder();
    } catch {
      setError(copy.supportFolderFailed);
    }
  }

  return (
    <section className="support-panel" aria-label={copy.support}>
      <details
        onToggle={(event) => {
          if (event.currentTarget.open) {
            void loadDetails().catch(() => {
              // The localized error is stored by loadDetails.
            });
          }
        }}
      >
        <summary>
          <strong>{copy.support}</strong>
          <span>{copy.supportSummary}</span>
        </summary>
        <div className="support-content">
          <p>{copy.supportGuidance}</p>
          {visibleDetails && (
            <SupportDetailsList copy={copy} details={visibleDetails} />
          )}
          <div className="support-actions">
            <button
              className="secondary"
              disabled={isGenerating}
              onClick={() => void copyDetails()}
            >
              {copy.copyDeviceDetails}
            </button>
            <button
              ref={generateButtonRef}
              disabled={isGenerating}
              onClick={() => void requestBundle()}
            >
              {copy.generateSupportBundle}
            </button>
            <button
              className="secondary"
              disabled={isGenerating}
              onClick={() => void openFolder()}
            >
              {copy.openSupportFolder}
            </button>
          </div>
          {status && (
            <p className="support-status" role="status" aria-live="polite">
              {status}
            </p>
          )}
          {bundle && bundle.warnings.length > 0 && (
            <p className="support-warning" role="status">
              {copy.supportWarnings.replace(
                "{count}",
                String(bundle.warnings.length),
              )}
            </p>
          )}
          {error && (
            <p className="support-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </details>
      {confirming && visibleDetails && (
        <dialog
          ref={dialogRef}
          className="support-dialog"
          aria-labelledby="support-confirmation-title"
          aria-describedby="support-confirmation-description"
          onCancel={(event) => {
            event.preventDefault();
            closeConfirmation();
          }}
        >
          <h2 id="support-confirmation-title">{copy.supportConfirmTitle}</h2>
          <dl>
            <Detail
              label={copy.supportUsername}
              value={visibleDetails.username}
            />
            <Detail
              label={copy.supportDeviceName}
              value={visibleDetails.deviceName}
            />
            <Detail
              label={copy.supportSerial}
              value={visibleDetails.smbiosSerial ?? copy.notAvailable}
            />
            <Detail
              label={copy.supportRelutionIp}
              value={
                visibleDetails.matchedRelutionLastIp ??
                copy.notReportedByRelution
              }
            />
          </dl>
          <p
            id="support-confirmation-description"
            className="support-local-note"
          >
            {copy.supportConfirmDescription}
          </p>
          <div className="dialog-actions">
            <button
              ref={cancelRef}
              className="secondary"
              onClick={closeConfirmation}
            >
              {copy.cancel}
            </button>
            <button onClick={() => void generateBundle()}>
              {copy.confirm}
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}

function SupportDetailsList({
  copy,
  details,
}: {
  copy: ReturnType<typeof copyFor>;
  details: SupportDetails;
}) {
  return (
    <dl className="support-details">
      <Detail
        label={copy.supportWindows}
        value={
          details.windowsDisplay === "unsupported" ||
          details.windowsDisplay === "unknown"
            ? copy.notAvailable
            : details.windowsDisplay
        }
      />
      <Detail
        label={copy.supportManufacturer}
        value={details.manufacturer ?? copy.notAvailable}
      />
      <Detail
        label={copy.supportModel}
        value={details.model ?? copy.notAvailable}
      />
      <Detail
        label={copy.supportSerial}
        value={details.smbiosSerial ?? copy.notAvailable}
      />
      <Detail
        label={copy.supportRelutionConnection}
        value={
          details.matchedRelutionLastConnectionAt ?? copy.notReportedByRelution
        }
      />
      <Detail
        label={copy.supportRelutionIp}
        value={details.matchedRelutionLastIp ?? copy.notReportedByRelution}
      />
      <Detail label={copy.supportDeviceStatus} value={details.deviceStatus} />
      <Detail label={copy.supportAppVersion} value={details.appVersion} />
      <Detail
        label={copy.supportSourceRevision}
        value={details.sourceRevision}
      />
      <Detail
        label={copy.supportAssignedCount}
        value={String(details.assignedEligibleCount)}
      />
      <Detail
        label={copy.supportAvailableCount}
        value={String(details.availableCount)}
      />
      <Detail
        label={copy.supportUpdateCount}
        value={String(details.updateCount)}
      />
    </dl>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatDetails(
  copy: ReturnType<typeof copyFor>,
  details: SupportDetails,
) {
  return [
    `Appport ${copy.support}:`,
    `${copy.supportUsername}: ${details.username}`,
    `${copy.supportDeviceName}: ${details.deviceName}`,
    `${copy.supportWindows}: ${details.windowsDisplay}`,
    `${copy.supportManufacturer}: ${details.manufacturer ?? copy.notAvailable}`,
    `${copy.supportModel}: ${details.model ?? copy.notAvailable}`,
    `${copy.supportSerial}: ${details.smbiosSerial ?? copy.notAvailable}`,
    `${copy.supportRelutionConnection}: ${details.matchedRelutionLastConnectionAt ?? copy.notReportedByRelution}`,
    `${copy.supportRelutionIp}: ${details.matchedRelutionLastIp ?? copy.notReportedByRelution}`,
    `${copy.supportDeviceStatus}: ${details.deviceStatus}`,
    `${copy.supportAppVersion}: ${details.appVersion}`,
    `${copy.supportSourceRevision}: ${details.sourceRevision}`,
    `${copy.supportAssignedCount}: ${details.assignedEligibleCount}`,
    `${copy.supportAvailableCount}: ${details.availableCount}`,
    `${copy.supportUpdateCount}: ${details.updateCount}`,
  ].join("\n");
}

function formatBytes(locale: Locale, bytes: number) {
  return new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-US", {
    style: "unit",
    unit: "kilobyte",
    maximumFractionDigits: 1,
  }).format(bytes / 1024);
}
