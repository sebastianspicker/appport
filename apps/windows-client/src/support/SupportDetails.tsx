import { type Copy, type Locale } from "../i18n/copy";
import type { SupportDetails } from "../native-bridge/types";

export function SupportDetailsList({
  copy,
  details,
}: {
  copy: Copy;
  details: SupportDetails;
}) {
  return (
    <dl className="support-details">
      {supportDetailRows(copy, details).map(({ label, value }) => (
        <Detail key={label} label={label} value={value} />
      ))}
    </dl>
  );
}

function supportDetailRows(copy: Copy, details: SupportDetails) {
  const unavailable = copy.notAvailable;
  const notReported = copy.notReportedByRelution;
  return [
    [copy.supportDeviceName, details.deviceName],
    [copy.supportUsername, details.username],
    [copy.supportWindows, windowsDisplay(details.windowsDisplay, unavailable)],
    [copy.supportManufacturer, availableOr(details.manufacturer, unavailable)],
    [copy.supportModel, availableOr(details.model, unavailable)],
    [copy.supportSerial, availableOr(details.smbiosSerial, unavailable)],
    [
      copy.supportRelutionConnection,
      availableOr(details.matchedRelutionLastConnectionAt, notReported),
    ],
    [
      copy.supportRelutionIp,
      availableOr(details.matchedRelutionLastIp, notReported),
    ],
    [copy.supportDeviceStatus, details.deviceStatus],
    [copy.supportAppVersion, details.appVersion],
    [copy.supportSourceRevision, details.sourceRevision],
    [copy.supportAssignedCount, String(details.assignedEligibleCount)],
    [copy.supportAvailableCount, String(details.availableCount)],
    [copy.supportUpdateCount, String(details.updateCount)],
  ].map(([label, value]) => ({ label, value }));
}

function availableOr(value: string | null, fallback: string) {
  return value ?? fallback;
}

function windowsDisplay(value: string, unavailable: string) {
  return value === "unsupported" || value === "unknown" ? unavailable : value;
}

export function SupportConfirmationDetails({
  copy,
  details,
}: {
  copy: Copy;
  details: SupportDetails;
}) {
  return (
    <dl>
      <Detail label={copy.supportUsername} value={details.username} />
      <Detail label={copy.supportDeviceName} value={details.deviceName} />
      <Detail
        label={copy.supportSerial}
        value={details.smbiosSerial ?? copy.notAvailable}
      />
      <Detail
        label={copy.supportRelutionIp}
        value={details.matchedRelutionLastIp ?? copy.notReportedByRelution}
      />
    </dl>
  );
}

export function formatSupportDetails(copy: Copy, details: SupportDetails) {
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

export function formatSupportBytes(locale: Locale, bytes: number) {
  return new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-US", {
    style: "unit",
    unit: "kilobyte",
    maximumFractionDigits: 1,
  }).format(bytes / 1024);
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
