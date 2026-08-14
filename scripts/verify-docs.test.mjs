import assert from "node:assert/strict";
import test from "node:test";
import {
  documentedPnpmScripts,
  missingPnpmScripts,
  standaloneBoundaryFailures,
} from "./verify-docs.mjs";

const rootManifest = {
  scripts: {
    "docs:verify": "node scripts/verify-docs.mjs",
    format: "prettier --write",
    "root-only": "node root-only.mjs",
  },
};
const clientManifest = {
  scripts: {
    dev: "vite",
    tauri: "tauri",
  },
};

function manifestForDirectory(directory) {
  return directory === "apps/windows-client" ? clientManifest : undefined;
}

test("validates root pnpm scripts and permits non-script commands", () => {
  const commands = documentedPnpmScripts(`
    \`pnpm docs:verify\`
    \`pnpm run format\`
    \`pnpm install --frozen-lockfile\`
    \`pnpm exec prettier --check .\`
  `);

  assert.deepEqual(
    missingPnpmScripts(commands, rootManifest, manifestForDirectory),
    [],
  );
});

test("validates package scripts from pnpm --dir commands", () => {
  const commands = documentedPnpmScripts(`
    \`pnpm --dir apps/windows-client dev\`
    \`pnpm --dir apps/windows-client run tauri\`
  `);

  assert.deepEqual(
    missingPnpmScripts(commands, rootManifest, manifestForDirectory),
    [],
  );
});

test("rejects documented scripts missing from their package manifest", () => {
  const commands = documentedPnpmScripts(`
    \`pnpm missing\`
    \`pnpm --dir apps/windows-client run root-only\`
  `);

  assert.deepEqual(
    missingPnpmScripts(commands, rootManifest, manifestForDirectory),
    [
      "references missing package script missing",
      "references missing package script root-only in apps/windows-client",
    ],
  );
});

test("accepts a clean standalone rewrite boundary", () => {
  assert.deepEqual(
    standaloneBoundaryFailures(() => false),
    [],
  );
});

for (const retiredPath of [
  "src/app",
  "src/server",
  "packages/appport-contracts",
  "scripts/revoke-native-sessions.mjs",
]) {
  test(`rejects the retired ${retiredPath} path`, () => {
    assert.deepEqual(
      standaloneBoundaryFailures((path) => path === retiredPath),
      [`standalone repository must not contain ${retiredPath}`],
    );
  });
}
