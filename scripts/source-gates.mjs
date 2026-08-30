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
  ["evidence-tests", "pnpm", ["evidence:test"]],
  ["qualification", "pnpm", ["qualification:check"]],
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
