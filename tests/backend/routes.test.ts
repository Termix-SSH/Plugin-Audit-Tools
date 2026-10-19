import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express, { type Router } from "express";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginAuditEntry } from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";
import { filtersFromQuery } from "../../src/backend/routes.js";

const manifest = manifestJson as unknown as PluginManifest;

const stored: PluginAuditEntry[] = [
  {
    id: 1,
    timestamp: "2026-10-18T10:00:01.000Z",
    userId: "u1",
    username: "root",
    action: "login",
    resourceType: "user",
    resourceId: null,
    resourceName: "=evil()",
    details: null,
    ipAddress: null,
    userAgent: null,
    success: true,
    errorMessage: null,
  },
  {
    id: 2,
    timestamp: "2026-10-18T10:00:02.000Z",
    userId: "u1",
    username: "root",
    action: "logout",
    resourceType: "user",
    resourceId: null,
    resourceName: null,
    details: null,
    ipAddress: null,
    userAgent: null,
    success: false,
    errorMessage: null,
  },
];

let mock: MockPluginContext;
let server: http.Server;
let port: number;

async function boot(permissions: string[]) {
  let router: Router | null = null;
  mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    router: () => (router = express.Router()),
    permissions,
    auditEntries: stored,
  });
  await activate(mock.ctx);
  const app = express();
  app.use((_req, _res, next) => {
    mock.setActor("admin-1");
    next();
  });
  app.use((req, res, next) => router!(req, res, next));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("filtersFromQuery", () => {
  it("keeps only set filters and reads success as a boolean", () => {
    expect(
      filtersFromQuery({ action: "login", success: "false", userId: "" }),
    ).toEqual({
      userId: undefined,
      action: "login",
      resourceType: undefined,
      success: false,
      startDate: undefined,
      endDate: undefined,
    });
  });
});

describe("GET /export", () => {
  beforeEach(async () => {
    await boot([`${manifest.id}.export`]);
  });

  it("streams csv with a header, the formula guard and an audit line", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/export`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toMatch(
      /termix-audit-.*\.csv/,
    );
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("'=evil()");

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mock.audits).toContainEqual(
      expect.objectContaining({ action: "export_audit_logs", success: true }),
    );
  });

  it("streams ndjson and applies filters", async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/export?format=ndjson&success=false`,
    );
    const lines = (await response.text()).trimEnd().split("\n");
    expect(response.headers.get("content-type")).toContain("ndjson");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).action).toBe("logout");
  });
});

describe("export permission", () => {
  it("refuses a user without it", async () => {
    await boot([]);
    const response = await fetch(`http://127.0.0.1:${port}/export`);
    expect(response.status).toBe(403);
  });
});
