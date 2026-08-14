import { createHash } from "node:crypto";
import process from "node:process";

const fs = process.getBuiltinModule("node:fs");

export function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function readRegularFile(path, maximumBytes) {
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) {
    throw new Error(
      "Evidence input must be a bounded regular non-symlink file.",
    );
  }
  return { stat, contents: fs.readFileSync(path) };
}

export function regularFileDigest(path) {
  try {
    return hash(readRegularFile(path, 1024 * 1024).contents);
  } catch {
    return null;
  }
}
