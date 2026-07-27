import { getLiveRuntimeConfig } from "@/server/runtime-config";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createActionRepository } from "./repository";

let repository: ReturnType<typeof createActionRepository> | undefined;
let cleanedAt = 0;

export function getActionRepository() {
  const mockMode =
    process.env.NODE_ENV !== "production" &&
    process.env.RELUTION_GATEWAY_MODE === "mock";
  const sqlitePath =
    process.env.APPPORT_SQLITE_PATH ??
    (mockMode
      ? join(tmpdir(), "relution-appport-mock.sqlite")
      : getLiveRuntimeConfig().sqlitePath);
  repository ??= createActionRepository(sqlitePath);
  const now = Date.now();
  if (now - cleanedAt >= 24 * 60 * 60 * 1_000) {
    repository.cleanup(
      mockMode ? 90 : getLiveRuntimeConfig().auditRetentionDays,
      now,
    );
    repository.cleanupNativeAuth(now);
    cleanedAt = now;
  }
  return repository;
}

export function closeActionRepository() {
  repository?.close();
  repository = undefined;
  cleanedAt = 0;
}
