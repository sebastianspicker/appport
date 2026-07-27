import { GatewayError } from "./errors";

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(value: JsonRecord, field: string): string;
export function stringField(
  value: JsonRecord,
  field: string,
  required: true,
): string;
export function stringField(
  value: JsonRecord,
  field: string,
  required: false,
): string | null;
export function stringField(
  value: JsonRecord,
  field: string,
  required = true,
): string | null {
  const item = value[field];
  if (typeof item === "string" && item.trim()) return item;
  if (!required && (item === undefined || item === null || item === "")) {
    return null;
  }
  throw invalid();
}

export function booleanField(value: JsonRecord, field: string) {
  const item = value[field];
  if (typeof item === "boolean") return item;
  return null;
}

export function numberField(value: JsonRecord, field: string) {
  const item = value[field];
  if (typeof item === "number" && Number.isFinite(item)) return item;
  return null;
}

export function recordField(value: JsonRecord, field: string) {
  const item = value[field];
  if (isRecord(item)) return item;
  throw invalid();
}

export function optionalRecordField(value: JsonRecord, field: string) {
  const item = value[field];
  return isRecord(item) ? item : null;
}

export function arrayField(value: JsonRecord, field: string) {
  const item = value[field];
  if (Array.isArray(item) && item.every(isRecord)) return item;
  throw invalid();
}

export function decodeWrapper(value: unknown) {
  if (!isRecord(value)) throw invalid();
  const results = arrayField(value, "results");
  const totalValue = value.total;
  const total =
    totalValue === undefined || totalValue === null
      ? null
      : typeof totalValue === "number" &&
          Number.isInteger(totalValue) &&
          totalValue >= 0
        ? totalValue
        : (() => {
            throw invalid();
          })();
  return { results, total };
}

export function decodeItems(value: unknown) {
  if (!isRecord(value)) throw invalid();
  const items = arrayField(value, "items");
  const countValue = value.nonpagedCount;
  const total =
    countValue === undefined || countValue === null
      ? null
      : typeof countValue === "number" &&
          Number.isInteger(countValue) &&
          countValue >= 0
        ? countValue
        : (() => {
            throw invalid();
          })();
  return { results: items, total };
}

export function invalid() {
  return new GatewayError(
    "INVALID_RESPONSE",
    "Relution returned an unexpected response.",
  );
}
