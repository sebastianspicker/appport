import { createHash } from "node:crypto";
import type { NativeDeviceEvidenceV1 } from "@/domain/models";

export interface DeviceMatchCandidate {
  uuid: string;
  deviceId: string | null;
  serialNumber: string | null;
  name: string;
}

export type DeviceMatchMethod =
  | "ent_dmid"
  | "smbios_uuid"
  | "serial_and_hostname";

export interface DeviceMatchResult<T extends DeviceMatchCandidate> {
  device: T;
  method: DeviceMatchMethod;
  evidenceDigest: string;
}

export class DeviceMatchError extends Error {
  constructor(
    public readonly reason:
      | "invalid_evidence"
      | "no_match"
      | "ambiguous_match"
      | "conflicting_evidence",
  ) {
    super("This Windows device could not be matched to one assigned Relution device.");
    this.name = "DeviceMatchError";
  }
}

const INVALID_VALUES = new Set([
  "0",
  "unknown",
  "none",
  "null",
  "not applicable",
  "not specified",
  "system serial number",
  "to be filled by o.e.m.",
  "default string",
]);

function normalized(value: string | null | undefined) {
  if (!value) return null;
  const result = value.trim().toLowerCase().replace(/^\{|\}$/g, "");
  if (
    !result ||
    INVALID_VALUES.has(result) ||
    /^0+$/.test(result.replaceAll("-", ""))
  ) {
    return null;
  }
  return result;
}

function validateEvidence(evidence: NativeDeviceEvidenceV1) {
  if (evidence.version !== 1) {
    throw new DeviceMatchError("invalid_evidence");
  }
  const hostname = normalized(evidence.hostname);
  const entDmid = normalized(evidence.entDmid);
  const smbiosUuid = normalized(evidence.smbiosUuid);
  const biosSerial = normalized(evidence.biosSerial);
  if (!hostname || (!entDmid && !smbiosUuid && !biosSerial)) {
    throw new DeviceMatchError("invalid_evidence");
  }
  return { hostname, entDmid, smbiosUuid, biosSerial };
}

function matchesFor(
  candidates: DeviceMatchCandidate[],
  predicate: (candidate: DeviceMatchCandidate) => boolean,
) {
  return new Set(candidates.filter(predicate).map((candidate) => candidate.uuid));
}

export function matchCurrentDevice<T extends DeviceMatchCandidate>(
  evidence: NativeDeviceEvidenceV1,
  candidates: T[],
): DeviceMatchResult<T> {
  const values = validateEvidence(evidence);
  const strongSignals: Array<{
    method: DeviceMatchMethod;
    matches: Set<string>;
  }> = [];

  if (values.entDmid) {
    strongSignals.push({
      method: "ent_dmid",
      matches: matchesFor(
        candidates,
        (candidate) => normalized(candidate.deviceId) === values.entDmid,
      ),
    });
  }
  if (values.smbiosUuid) {
    strongSignals.push({
      method: "smbios_uuid",
      matches: matchesFor(
        candidates,
        (candidate) => normalized(candidate.deviceId) === values.smbiosUuid,
      ),
    });
  }
  const fallback =
    values.biosSerial === null
      ? null
      : {
          method: "serial_and_hostname" as const,
          matches: matchesFor(
            candidates,
            (candidate) =>
              normalized(candidate.serialNumber) === values.biosSerial &&
              normalized(candidate.name) === values.hostname,
          ),
        };

  const matchedStrong = strongSignals.filter(
    (signal) => signal.matches.size > 0,
  );
  const signals =
    matchedStrong.length > 0
      ? [
          ...matchedStrong,
          ...(fallback && fallback.matches.size > 0 ? [fallback] : []),
        ]
      : fallback
        ? [fallback]
        : [];
  if (
    signals.length === 0 ||
    signals.every((signal) => signal.matches.size === 0)
  ) {
    throw new DeviceMatchError("no_match");
  }
  const matchedSignals = signals.filter((signal) => signal.matches.size > 0);
  const agreed = [...matchedSignals[0].matches].filter((uuid) =>
    matchedSignals.every((signal) => signal.matches.has(uuid)),
  );
  if (agreed.length === 0) {
    throw new DeviceMatchError("conflicting_evidence");
  }
  if (agreed.length !== 1) {
    throw new DeviceMatchError("ambiguous_match");
  }
  const device = candidates.find((candidate) => candidate.uuid === agreed[0]);
  if (!device) throw new DeviceMatchError("no_match");

  const method =
    matchedSignals.find((signal) => signal.method === "ent_dmid")?.method ??
    matchedSignals.find((signal) => signal.method === "smbios_uuid")?.method ??
    "serial_and_hostname";
  const evidenceDigest = createHash("sha256")
    .update(
      JSON.stringify({
        entDmid: values.entDmid,
        smbiosUuid: values.smbiosUuid,
        biosSerial: values.biosSerial,
        hostname: values.hostname,
      }),
    )
    .digest("hex");
  return { device, method, evidenceDigest };
}
