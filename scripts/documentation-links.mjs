import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";

export function documentationLinkFailures(root, path, markdownContents) {
  const failures = [];
  const contents = markdownContents.get(path);
  for (const match of contents.matchAll(/!?\[[^\]\r\n]*\]\(([^()\r\n]*)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "");
    verifyLink(root, failures, path, target, markdownContents);
  }
  return failures;
}

function verifyLink(root, failures, path, rawTarget, markdownContents) {
  if (isExternalTarget(rawTarget)) return;
  const { rawFile, rawAnchor, target } = resolveTarget(path, rawTarget);
  if (relative(root, target).startsWith("..")) {
    failures.push(`${relative(root, path)} links outside the repository`);
    return;
  }
  if (!existsSync(target)) {
    failures.push(
      `${relative(root, path)} links to missing ${rawFile || rawTarget}`,
    );
    return;
  }
  verifyAnchor(root, failures, path, target, rawAnchor, markdownContents);
}

function isExternalTarget(rawTarget) {
  return (
    !rawTarget ||
    /^(?:https?:|mailto:|data:)/i.test(rawTarget) ||
    rawTarget.startsWith("/")
  );
}

function resolveTarget(path, rawTarget) {
  const [rawFile, rawAnchor] = rawTarget.split("#", 2);
  return {
    rawFile,
    rawAnchor,
    target: rawFile
      ? resolve(dirname(path), decodeURIComponent(rawFile))
      : path,
  };
}

function verifyAnchor(
  root,
  failures,
  path,
  target,
  rawAnchor,
  markdownContents,
) {
  if (!rawAnchor || extname(target) !== ".md") return;
  const anchors = markdownAnchors(
    markdownContents.get(target) ?? readFileSync(target, "utf8"),
  );
  if (anchors.has(decodeURIComponent(rawAnchor).toLowerCase())) return;
  failures.push(
    `${relative(root, path)} links to missing anchor #${rawAnchor} in ${relative(root, target)}`,
  );
}

function markdownAnchors(contents) {
  const anchors = new Set();
  const counts = new Map();
  for (const line of contents.split("\n")) {
    const match = /^(?:#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;
    const base = match[1]
      .toLowerCase()
      .replace(/[`*_~]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    const storedCount = counts.get(base);
    const count = storedCount === undefined ? 0 : storedCount;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}
