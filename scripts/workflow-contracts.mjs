const requiredDemoPagePaths = Object.freeze([
  ".github/workflows/demo-pages.yml",
  "apps/web-demo/**",
  "apps/windows-client/src-tauri/tauri.conf.json",
  "eslint.config.mjs",
  "jscpd.demo.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "quality-duplication-baseline.json",
  "scripts/check-duplicates.mjs",
  "scripts/check-source-size.mjs",
  "scripts/verify-demo-artifact.mjs",
  "stylelint.config.mjs",
]);

export function verificationWorkflowFailures(workflow, scripts) {
  const failures = packageScriptFailures(workflow, scripts, "verify workflow");
  const jobs = mappingBlock(workflow, "jobs", 0);
  const demo = mappingBlock(jobs, "demo", 2);
  if (!demo) {
    failures.push("verify workflow is missing an independent demo job");
    return failures;
  }
  if (!/\brun:\s*pnpm demo:verify\s*$/m.test(demo)) {
    failures.push("verify demo job must run pnpm demo:verify");
  }
  if (/^ {4}needs:/m.test(demo)) {
    failures.push("verify demo job must remain independent");
  }
  return failures;
}

export function demoPagesWorkflowFailures(workflow, scripts) {
  const failures = packageScriptFailures(workflow, scripts, "Pages workflow");
  const trigger = mappingBlock(workflow, "on", 0);
  verifyPagesEvents(failures, trigger);
  verifyPagesPaths(failures, trigger);
  verifyPagesArtifact(failures, workflow);
  return failures;
}

function packageScriptFailures(workflow, scripts, label) {
  const failures = [];
  for (const match of workflow.matchAll(/\bpnpm\s+([a-z][\w:-]*)/g)) {
    const name = match[1];
    if (name === "install" || name === "exec") continue;
    if (!Object.hasOwn(scripts, name)) {
      failures.push(`${label} invokes missing package script ${name}`);
    }
  }
  return failures;
}

function verifyPagesEvents(failures, trigger) {
  const events = mappingKeys(trigger, 2);
  if (
    events.length !== 2 ||
    !events.includes("push") ||
    !events.includes("workflow_dispatch")
  ) {
    failures.push(
      "Pages workflow must run only for pushes and manual dispatch",
    );
  }
  const push = mappingBlock(trigger, "push", 2);
  if (!/^ {4}branches:\s*\[main\]\s*$/m.test(push)) {
    failures.push("Pages workflow push trigger must target main only");
  }
}

function verifyPagesPaths(failures, trigger) {
  const push = mappingBlock(trigger, "push", 2);
  const paths = listValues(mappingBlock(push, "paths", 4), 6);
  for (const path of requiredDemoPagePaths) {
    if (!paths.includes(path)) {
      failures.push(`Pages workflow path trigger is missing ${path}`);
    }
  }
  if (paths.includes("apps/windows-client/src/styles.css")) {
    failures.push("Pages workflow must not depend on the desktop stylesheet");
  }
}

function verifyPagesArtifact(failures, workflow) {
  const jobs = mappingBlock(workflow, "jobs", 0);
  const build = mappingBlock(jobs, "build", 2);
  const deploy = mappingBlock(jobs, "deploy", 2);
  if (!/\brun:\s*pnpm demo:verify\s*$/m.test(build)) {
    failures.push("Pages build job must run pnpm demo:verify");
  }
  if (
    !/actions\/upload-pages-artifact@/.test(build) ||
    !/^ {10}path:\s*apps\/web-demo\/dist\s*$/m.test(build)
  ) {
    failures.push("Pages build job must upload only the demo dist artifact");
  }
  if (
    !/^ {4}needs:\s*build\s*$/m.test(deploy) ||
    !/actions\/deploy-pages@/.test(deploy)
  ) {
    failures.push("Pages deploy job must deploy the existing build artifact");
  }
}

function mappingBlock(contents, key, indent) {
  if (!contents) return "";
  const lines = contents.split("\n");
  const prefix = `${" ".repeat(indent)}${key}:`;
  const start = lines.findIndex((line) => line.startsWith(prefix));
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const leadingSpaces = line.length - line.trimStart().length;
    if (leadingSpaces <= indent) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function mappingKeys(contents, indent) {
  const prefix = " ".repeat(indent);
  return contents
    .split("\n")
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix} `))
    .map((line) => /^\s*([\w-]+):/.exec(line)?.[1])
    .filter(Boolean);
}

function listValues(contents, indent) {
  const prefix = `${" ".repeat(indent)}- `;
  return contents
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) =>
      line
        .slice(prefix.length)
        .trim()
        .replace(/^["']|["']$/g, ""),
    );
}
