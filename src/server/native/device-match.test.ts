import { describe, expect, it } from "vitest";
import type { NativeDeviceEvidenceV1 } from "@/domain/models";
import {
  matchCurrentDevice,
  type DeviceMatchCandidate,
} from "./device-match";

const devices: DeviceMatchCandidate[] = [
  {
    uuid: "relution-office",
    deviceId: "6B29FC40-CA47-1067-B31D-00DD010662DA",
    serialNumber: "OFFICE-001",
    name: "OFFICE-LAPTOP",
  },
  {
    uuid: "relution-travel",
    deviceId: "travel-ent-dmid",
    serialNumber: "TRAVEL-002",
    name: "TRAVEL-LAPTOP",
  },
];

function evidence(
  values: Partial<NativeDeviceEvidenceV1> = {},
): NativeDeviceEvidenceV1 {
  return {
    version: 1,
    hostname: "OFFICE-LAPTOP",
    entDmid: "6b29fc40-ca47-1067-b31d-00dd010662da",
    ...values,
  };
}

describe("matchCurrentDevice", () => {
  it("matches a normalized EntDMID without returning raw evidence", () => {
    const result = matchCurrentDevice(
      evidence({ smbiosUuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
      devices,
    );
    expect(result).toMatchObject({
      device: { uuid: "relution-office" },
      method: "ent_dmid",
    });
    expect(result.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result).not.toHaveProperty("evidence");
  });

  it("matches an SMBIOS UUID when it is the Relution device identifier", () => {
    expect(
      matchCurrentDevice(
        evidence({
          entDmid: undefined,
          smbiosUuid: "{6B29FC40-CA47-1067-B31D-00DD010662DA}",
        }),
        devices,
      ),
    ).toMatchObject({
      device: { uuid: "relution-office" },
      method: "smbios_uuid",
    });
  });

  it("uses serial and hostname only as a corroborated fallback", () => {
    expect(
      matchCurrentDevice(
        evidence({
          entDmid: undefined,
          biosSerial: " office-001 ",
        }),
        devices,
      ),
    ).toMatchObject({
      device: { uuid: "relution-office" },
      method: "serial_and_hostname",
    });
  });

  it("fails closed when available identifiers disagree", () => {
    expect(() =>
      matchCurrentDevice(
        evidence({
          biosSerial: "TRAVEL-002",
          hostname: "TRAVEL-LAPTOP",
        }),
        devices,
      ),
    ).toThrowError(
      expect.objectContaining({
        reason: "conflicting_evidence",
      }),
    );
  });

  it("rejects placeholder evidence and ambiguous matches", () => {
    expect(() =>
      matchCurrentDevice(
        evidence({ entDmid: "00000000-0000-0000-0000-000000000000" }),
        devices,
      ),
    ).toThrowError(
      expect.objectContaining({
        reason: "invalid_evidence",
      }),
    );

    expect(() =>
      matchCurrentDevice(
        evidence({ entDmid: undefined, biosSerial: "OFFICE-001" }),
        [...devices, { ...devices[0], uuid: "duplicate-office" }],
      ),
    ).toThrowError(
      expect.objectContaining({
        reason: "ambiguous_match",
      }),
    );
  });
});
