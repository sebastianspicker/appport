#!/usr/bin/env node

import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";

const argumentsByName = new Map();
let apply = false;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--") {
    continue;
  }
  if (argument === "--apply") {
    apply = true;
    continue;
  }
  if (!argument.startsWith("--") || index + 1 >= process.argv.length) {
    usage();
  }
  argumentsByName.set(argument.slice(2), process.argv[++index]);
}

const databasePath = argumentsByName.get("database");
const scope = argumentsByName.get("scope");
if (
  !databasePath ||
  !isAbsolute(databasePath) ||
  databasePath.includes("\0") ||
  !["all", "user", "device"].includes(scope)
) {
  usage();
}

const database = new DatabaseSync(databasePath);
try {
  const now = Date.now();
  const selection =
    scope === "all"
      ? {
          where: "revoked_at IS NULL",
          values: [],
        }
      : scope === "user"
        ? userSelection(argumentsByName)
        : deviceSelection(argumentsByName);
  const count = database
    .prepare(`SELECT COUNT(*) AS count FROM native_sessions WHERE ${selection.where}`)
    .get(...selection.values).count;

  if (!apply) {
    console.log(JSON.stringify({ apply: false, scope, matchingSessions: count }));
    process.exitCode = count > 0 ? 2 : 0;
  } else {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = database
        .prepare(
          `UPDATE native_sessions SET revoked_at = ?
           WHERE ${selection.where}`,
        )
        .run(now, ...selection.values);
      database.exec("COMMIT");
      console.log(
        JSON.stringify({
          apply: true,
          scope,
          revokedSessions: Number(result.changes),
        }),
      );
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
} finally {
  database.close();
}

function userSelection(values) {
  const issuer = values.get("issuer");
  const subject = values.get("subject");
  if (!issuer?.trim() || !subject?.trim()) usage();
  return {
    where:
      "owner_issuer = ? AND owner_subject = ? AND revoked_at IS NULL",
    values: [issuer, subject],
  };
}

function deviceSelection(values) {
  const device = values.get("device");
  if (!device?.trim() || device.length > 128 || device.includes("\0")) usage();
  return {
    where: "device_uuid = ? AND revoked_at IS NULL",
    values: [device],
  };
}

function usage() {
  console.error(
    "Usage: node scripts/revoke-native-sessions.mjs --database /absolute/appport.sqlite --scope all|user|device [--issuer value --subject value | --device value] [--apply]",
  );
  process.exit(64);
}
