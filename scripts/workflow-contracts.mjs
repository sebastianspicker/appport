import { parse } from "yaml";

const commitPin = /@[0-9a-f]{40}$/;
const pagesDeployPermissions = ["contents", "id-token", "pages"];
const pagesTriggerPaths = [
  "apps/web-demo/**",
  ".github/workflows/demo-pages.yml",
];

export function verificationWorkflowFailures(workflowText, scripts) {
  const workflow = parse(workflowText);
  const failures = commonWorkflowFailures(workflow, scripts, "verify workflow");
  const demo = workflow.jobs?.demo;
  if (!demo) {
    failures.push("verify workflow is missing an independent demo job");
    return failures;
  }
  if (!runCommands(demo).includes("pnpm demo:verify")) {
    failures.push("verify demo job must run pnpm demo:verify");
  }
  if (Object.hasOwn(demo, "needs")) {
    failures.push("verify demo job must remain independent");
  }
  return failures;
}

export function demoPagesWorkflowFailures(workflowText, scripts) {
  const workflow = parse(workflowText);
  const failures = commonWorkflowFailures(workflow, scripts, "Pages workflow");
  verifyPagesTriggers(failures, workflow.on);
  verifyPagesBuild(failures, workflow.jobs?.build);
  verifyPagesDeploy(failures, workflow.jobs?.deploy);
  return failures;
}

function commonWorkflowFailures(workflow, scripts, label) {
  return [
    ...packageScriptFailures(workflow, scripts, label),
    ...actionPinFailures(workflow, label),
    ...permissionFailures(workflow, label),
  ];
}

function jobsOf(workflow) {
  return Object.entries(workflow.jobs ?? {});
}

function stepsOf(job) {
  return Array.isArray(job?.steps) ? job.steps : [];
}

function runCommands(job) {
  return stepsOf(job)
    .filter((step) => typeof step.run === "string")
    .flatMap((step) => step.run.split("\n").map((line) => line.trim()));
}

function packageScriptFailures(workflow, scripts, label) {
  const failures = [];
  for (const [, job] of jobsOf(workflow)) {
    for (const command of runCommands(job)) {
      for (const match of command.matchAll(/\bpnpm\s+([a-z][\w:-]*)/g)) {
        const name = match[1];
        if (name === "install" || name === "exec") continue;
        if (!Object.hasOwn(scripts, name)) {
          failures.push(`${label} invokes missing package script ${name}`);
        }
      }
    }
  }
  return failures;
}

function actionPinFailures(workflow, label) {
  const failures = [];
  for (const [name, job] of jobsOf(workflow)) {
    for (const step of stepsOf(job)) {
      const uses = step.uses;
      if (typeof uses !== "string" || uses.startsWith("./")) continue;
      if (!commitPin.test(uses)) {
        failures.push(
          `${label} job ${name} uses ${uses} without a full commit SHA pin`,
        );
      }
    }
  }
  return failures;
}

function permissionFailures(workflow, label) {
  const failures = [];
  if (!isReadOnlyContents(workflow.permissions)) {
    failures.push(
      `${label} top-level permissions must be exactly contents: read`,
    );
  }
  for (const [name, job] of jobsOf(workflow)) {
    if (job.permissions === undefined) continue;
    const allowed = label === "Pages workflow" && name === "deploy";
    if (!allowed || !isPagesDeployPermissions(job.permissions)) {
      failures.push(`${label} job ${name} must not widen permissions`);
    }
  }
  return failures;
}

function isReadOnlyContents(permissions) {
  const keys = Object.keys(permissions ?? {});
  return keys.length === 1 && permissions.contents === "read";
}

function isPagesDeployPermissions(permissions) {
  const keys = Object.keys(permissions ?? {}).sort();
  return (
    keys.join() === pagesDeployPermissions.join() &&
    permissions.contents === "read" &&
    permissions["id-token"] === "write" &&
    permissions.pages === "write"
  );
}

function verifyPagesTriggers(failures, trigger) {
  const events = Object.keys(trigger ?? {}).sort();
  if (events.join() !== "push,workflow_dispatch") {
    failures.push(
      "Pages workflow must run only for pushes and manual dispatch",
    );
  }
  const branches = trigger?.push?.branches;
  if (!Array.isArray(branches) || branches.join() !== "main") {
    failures.push("Pages workflow push trigger must target main only");
  }
  verifyPagesTriggerPaths(failures, trigger?.push?.paths);
}

function verifyPagesTriggerPaths(failures, paths) {
  if (
    paths !== undefined &&
    (!Array.isArray(paths) ||
      !pagesTriggerPaths.every((path) => paths.includes(path)))
  ) {
    failures.push(
      `Pages workflow push paths must include ${pagesTriggerPaths.join(" and ")}`,
    );
  }
}

function verifyPagesBuild(failures, build) {
  if (!runCommands(build).includes("pnpm demo:verify")) {
    failures.push("Pages build job must run pnpm demo:verify");
  }
  const uploads = stepsOf(build).filter((step) =>
    step.uses?.startsWith("actions/upload-pages-artifact@"),
  );
  const paths = uploads.map((step) => step.with?.path);
  if (paths.length !== 1 || paths[0] !== "apps/web-demo/dist") {
    failures.push("Pages build job must upload only the demo dist artifact");
  }
}

function verifyPagesDeploy(failures, deploy) {
  const deploysPages = stepsOf(deploy).some((step) =>
    step.uses?.startsWith("actions/deploy-pages@"),
  );
  if (deploy?.needs !== "build" || !deploysPages) {
    failures.push("Pages deploy job must deploy the existing build artifact");
  }
}
