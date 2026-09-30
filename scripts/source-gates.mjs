export const sourceVerificationEnvironment = Object.freeze({
  APPPORT_SOURCE_VERIFICATION: "true",
  APPPORT_RELUTION_API_BASE_URL: "https://source-verification.invalid",
  APPPORT_RELUTION_ORGANIZATION_UUID: "10000000-0000-4000-8000-000000000001",
  APPPORT_NATIVE_APP_UUID: "20000000-0000-4000-8000-000000000002",
  APPPORT_QUALIFICATION_PROFILE: "read_only",
  APPPORT_RELUTION_WRITES_ENABLED: "false",
  APPPORT_RELUTION_DIAGNOSTICS: "false",
  APPPORT_QUALIFICATION_TENANT_APPROVED: "",
  APPPORT_RELUTION_TENANT_CLASS: "",
  APPPORT_DISPOSABLE_RESOURCES_APPROVED: "",
});

export const sourceGateCommands = Object.freeze([
  ["toolchain", "pnpm", ["verify:toolchain"]],
  ["format", "pnpm", ["format:check"]],
  ["documentation", "pnpm", ["docs:verify"]],
  ["architecture", "pnpm", ["architecture:check"]],
  ["tooling-tests", "pnpm", ["tooling:test"]],
  ["evidence-tests", "pnpm", ["evidence:test"]],
  ["qualification", "pnpm", ["qualification:check"]],
  ["quality", "pnpm", ["quality:source:static"]],
  ["frontend-types", "pnpm", ["frontend:check"]],
  ["frontend-tests", "pnpm", ["frontend:test"]],
  ["frontend-build", "pnpm", ["frontend:build"]],
  ["rust-format", "pnpm", ["rust:fmt"]],
  ["rust-clippy", "pnpm", ["rust:clippy"]],
  ["rust-tests", "pnpm", ["rust:test"]],
  ["rust-check", "pnpm", ["rust:check"]],
]);

export const sourceGateNames = Object.freeze(
  sourceGateCommands.map(([name]) => name),
);

const staticQualityChecks = Object.freeze([
  "quality:lint:source",
  "quality:style:source",
  "quality:size:source",
  "quality:duplicates:source",
]);

export function sourceGateCompositionFailures(
  scripts,
  commands = sourceGateCommands,
) {
  const failures = [];
  const staticQuality = scripts["quality:source:static"] ?? "";
  for (const check of staticQualityChecks) {
    if (!staticQuality.includes(check)) {
      failures.push(`quality:source:static must invoke ${check}`);
    }
  }
  verifyGate(failures, commands, "quality", "quality:source:static");
  verifyGate(failures, commands, "tooling-tests", "tooling:test");

  const clippyGates = commands.filter(
    ([, executable, arguments_]) =>
      executable === "pnpm" && arguments_.includes("rust:clippy"),
  );
  if (clippyGates.length !== 1 || clippyGates[0][0] !== "rust-clippy") {
    failures.push(
      "aggregate source gates must run dedicated Clippy exactly once",
    );
  }
  return failures;
}

function verifyGate(failures, commands, name, script) {
  const matches = commands.filter(([gateName]) => gateName === name);
  if (
    matches.length !== 1 ||
    matches[0][1] !== "pnpm" ||
    matches[0][2].length !== 1 ||
    matches[0][2][0] !== script
  ) {
    failures.push(`${name} gate must invoke pnpm ${script} exactly once`);
  }
}
