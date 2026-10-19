import { describe, expect, it } from "vitest";
import type { PluginAuditEntry } from "@termix-ssh/plugin-sdk/backend";
import {
  csvHeader,
  escapeCsvField,
  exportFilename,
  toCsvRows,
  toNdjson,
} from "../../src/backend/export.js";

const entry = (
  overrides: Partial<PluginAuditEntry> = {},
): PluginAuditEntry => ({
  id: 1,
  timestamp: "2026-10-18T10:00:00.000Z",
  userId: "u1",
  username: "root",
  action: "login",
  resourceType: "user",
  resourceId: null,
  resourceName: null,
  details: null,
  ipAddress: "10.0.0.1",
  userAgent: null,
  success: true,
  errorMessage: null,
  ...overrides,
});

describe("escapeCsvField", () => {
  it("leaves plain text alone and quotes separators", () => {
    expect(escapeCsvField("hello")).toBe("hello");
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("two\nlines")).toBe('"two\nlines"');
  });

  it("writes null, undefined and booleans", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
    expect(escapeCsvField(true)).toBe("true");
  });

  it("neutralises spreadsheet formulas", () => {
    for (const value of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx"]) {
      expect(escapeCsvField(value).startsWith("'")).toBe(true);
    }
    expect(escapeCsvField("=a,b")).toBe(`"'=a,b"`);
  });
});

describe("csv and ndjson", () => {
  it("writes a header and one line per entry", () => {
    const csv = csvHeader() + toCsvRows([entry(), entry({ id: 2 })]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "id,timestamp,username,userId,action,resourceType,resourceId,resourceName,success,ipAddress,userAgent,errorMessage,details",
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      "1,2026-10-18T10:00:00.000Z,root,u1,login,user,,,true,10.0.0.1,,,",
    );
  });

  it("guards a hostile resource name in the file", () => {
    const csv = toCsvRows([entry({ resourceName: "=cmd|' /C calc'!A0" })]);
    expect(csv).toContain("'=cmd");
  });

  it("writes ndjson and nothing for no rows", () => {
    expect(toNdjson([])).toBe("");
    const lines = toNdjson([entry(), entry({ id: 2 })])
      .trimEnd()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).id).toBe(2);
  });

  it("names files by time and format", () => {
    const at = new Date("2026-10-18T10:20:30.000Z");
    expect(exportFilename("csv", at)).toBe(
      "termix-audit-2026-10-18-10-20-30.csv",
    );
    expect(exportFilename("ndjson", at)).toBe(
      "termix-audit-2026-10-18-10-20-30.ndjson",
    );
  });
});
