import { hash } from "./io.mjs";

const expectedWritesByProfile = {
  read_only: "false",
  write_qualification: "true",
};

export function inspectConfiguration(environment = process.env) {
  const values = qualificationConfigurationValues(environment);
  const failures = configurationFailures(values);
  const writesEnabled = values.writes === "true";
  const diagnosticsEnabled = values.diagnostics === "true";
  return {
    profile: values.profile || "invalid",
    valid: failures.length === 0,
    failures,
    fingerprintSha256: hash(
      `origin=${values.origin}\norganization=${values.organization}\nnativeApplication=${values.nativeApp}\nprofile=${values.profile}\nwrites=${values.writes}\ndiagnostics=${values.diagnostics}\ntenantApproved=${values.tenantApproved}\ntenantClass=${values.tenantClass}\ndisposableApproved=${values.disposableApproved}\n`,
    ),
    writesEnabled,
    diagnosticsEnabled,
  };
}

function qualificationConfigurationValues(environment) {
  return {
    origin: environment.APPPORT_RELUTION_API_BASE_URL ?? "",
    organization: environment.APPPORT_RELUTION_ORGANIZATION_UUID ?? "",
    nativeApp: environment.APPPORT_NATIVE_APP_UUID ?? "",
    profile: environment.APPPORT_QUALIFICATION_PROFILE ?? "",
    writes: environment.APPPORT_RELUTION_WRITES_ENABLED ?? "",
    diagnostics: environment.APPPORT_RELUTION_DIAGNOSTICS ?? "",
    tenantApproved: environment.APPPORT_QUALIFICATION_TENANT_APPROVED ?? "",
    tenantClass: environment.APPPORT_RELUTION_TENANT_CLASS ?? "",
    disposableApproved: environment.APPPORT_DISPOSABLE_RESOURCES_APPROVED ?? "",
  };
}

export function configurationFailures(values) {
  const expectedWrites = expectedWritesByProfile[values.profile] ?? null;
  return configurationRules(values, expectedWrites)
    .filter((rule) => !rule.valid)
    .map((rule) => rule.message);
}

function configurationRules(values, expectedWrites) {
  return [
    invalidRule(
      isQualificationOrigin(values.origin),
      "invalid qualification-tenant origin",
    ),
    invalidRule(
      isQualificationUuid(values.organization),
      "invalid organization UUID",
    ),
    invalidRule(
      isQualificationUuid(values.nativeApp),
      "invalid native application UUID",
    ),
    invalidRule(
      values.organization.toLowerCase() !== values.nativeApp.toLowerCase(),
      "organization and native application UUIDs must differ",
    ),
    invalidRule(expectedWrites !== null, "invalid qualification profile"),
    invalidRule(
      values.writes === expectedWrites,
      "writes do not exactly match profile",
    ),
    invalidRule(
      ["true", "false"].includes(values.diagnostics),
      "diagnostics must be exactly true or false",
    ),
    invalidRule(
      values.tenantApproved === "true",
      "qualification tenant is not approved",
    ),
    invalidRule(
      values.tenantClass === "qualification",
      "tenant class is not qualification",
    ),
    invalidRule(
      values.profile !== "write_qualification" ||
        values.disposableApproved === "true",
      "disposable resources are not approved",
    ),
  ];
}

function invalidRule(valid, message) {
  return { valid, message };
}

function isQualificationOrigin(value) {
  const url = parseQualificationOrigin(value);
  return Boolean(url && isSecureRootOrigin(url) && !isPlaceholderHost(url));
}

function parseQualificationOrigin(value) {
  if (!value || value.trim() !== value || value.length > 2048) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isSecureRootOrigin(url) {
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
}

function isPlaceholderHost(url) {
  const host = url.hostname.toLowerCase();
  return (
    host.endsWith(".invalid") ||
    ["localhost", "example.com", "example.test"].some(
      (placeholder) => host === placeholder || host.endsWith(`.${placeholder}`),
    )
  );
}

function isQualificationUuid(value) {
  if (!hasUuidShape(value)) return false;
  const compact = value.replaceAll("-", "").toLowerCase();
  return !/^0+$/.test(compact) && !/^(.)\1+$/.test(compact);
}

function hasUuidShape(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
