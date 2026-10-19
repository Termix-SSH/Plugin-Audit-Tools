import type { PluginAuditEntry } from "@termix-ssh/plugin-sdk/backend";

/** Column order for CSV export, also the header row. */
const COLUMNS = [
  "id",
  "timestamp",
  "username",
  "userId",
  "action",
  "resourceType",
  "resourceId",
  "resourceName",
  "success",
  "ipAddress",
  "userAgent",
  "errorMessage",
  "details",
] as const;

/**
 * RFC 4180 field escaping.
 *
 * A field starting with =, +, - or @ is a formula to spreadsheet software,
 * so an entry with an attacker chosen resource name could run on open. A
 * leading single quote stops that and keeps the value readable.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvHeader(): string {
  return `${COLUMNS.join(",")}\n`;
}

export function toCsvRows(rows: PluginAuditEntry[]): string {
  return rows
    .map(
      (row) =>
        `${COLUMNS.map((column) =>
          escapeCsvField((row as unknown as Record<string, unknown>)[column]),
        ).join(",")}\n`,
    )
    .join("");
}

/** One entry per line, which is what log shippers and SIEM bulk endpoints expect. */
export function toNdjson(rows: PluginAuditEntry[]): string {
  return rows.map((row) => `${JSON.stringify(row)}\n`).join("");
}

export function exportFilename(format: "csv" | "ndjson", now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `termix-audit-${stamp}.${format === "csv" ? "csv" : "ndjson"}`;
}
