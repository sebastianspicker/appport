import { sep } from "node:path";
import process from "node:process";

import { hash, readRegularFile } from "./io.mjs";

const msiMagic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function inspectMsiArtifact(path, forbiddenMarkers) {
  if (!path) return null;
  const { contents, ...artifact } = inspectBinary(
    path,
    1024 * 1024 * 1024,
    forbiddenMarkers,
  );
  if (!path.toLowerCase().endsWith(".msi")) {
    throw new Error("Release artifact must be an MSI file.");
  }
  const signatureStatus =
    process.platform === "win32" ? authenticodeStatus(path) : "not_checked";
  return {
    ...artifact,
    formatValid: hasMsiMagic(contents),
    signatureStatus,
    signed: signatureStatus === "valid",
  };
}

export function inspectQualificationUtility(path, forbiddenMarkers) {
  if (!path) return null;
  const { contents, ...artifact } = inspectBinary(
    path,
    256 * 1024 * 1024,
    forbiddenMarkers,
  );
  if (!path.toLowerCase().endsWith(".exe")) {
    throw new Error("Qualification utility must be a Windows executable.");
  }
  return {
    ...artifact,
    formatValid: hasWindowsExecutableMagic(contents),
  };
}

function inspectBinary(path, maximumBytes, forbiddenMarkers) {
  const { stat, contents } = readRegularFile(path, maximumBytes);
  const markers = matchingForbiddenMarkers(contents, forbiddenMarkers);
  return {
    name: path.split(sep).at(-1),
    bytes: stat.size,
    sha256: hash(contents),
    forbiddenMarkers: markers,
    embeddedSecretScanPassed: markers.length === 0,
    contents,
  };
}

function matchingForbiddenMarkers(contents, forbiddenMarkers) {
  return forbiddenMarkers.filter((marker) =>
    [Buffer.from(marker, "utf8"), Buffer.from(marker, "utf16le")].some(
      (encoded) => contents.includes(encoded),
    ),
  );
}

function hasMsiMagic(contents) {
  return (
    contents.length >= msiMagic.length &&
    contents.subarray(0, msiMagic.length).equals(msiMagic)
  );
}

function hasWindowsExecutableMagic(contents) {
  return (
    contents.length >= 2 &&
    contents[0] === "M".charCodeAt(0) &&
    contents[1] === "Z".charCodeAt(0)
  );
}

function authenticodeStatus(path) {
  const escaped = path.replaceAll("'", "''");
  const result = process
    .getBuiltinModule("node:child_process")
    .spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-AuthenticodeSignature -LiteralPath '${escaped}').Status.ToString().ToLowerInvariant()`,
      ],
      { encoding: "utf8" },
    );
  if (result.status !== 0) return "unknown";
  const status = result.stdout.trim().toLowerCase();
  return status === "notsigned" ? "not_signed" : status || "unknown";
}
