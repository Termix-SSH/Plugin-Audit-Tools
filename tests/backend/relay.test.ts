import { describe, expect, it } from "vitest";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginAuditEntry } from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { createForwarder } from "../../src/backend/forwarder.js";
import { CURSOR_KEY, createRelay } from "../../src/backend/relay.js";

const manifest = manifestJson as unknown as PluginManifest;

const line = (id: number): PluginAuditEntry => ({
  id,
  timestamp: new Date(Date.UTC(2026, 9, 18, 10, 0, id)).toISOString(),
  userId: null,
  username: "root",
  action: `action_${id}`,
  resourceType: "user",
  resourceId: null,
  resourceName: null,
  details: null,
  ipAddress: null,
  userAgent: null,
  success: true,
  errorMessage: null,
});

function setup(options: {
  stored: PluginAuditEntry[];
  cursor?: string;
  url?: string;
  respond?: (action: string) => number;
}) {
  const received: string[] = [];
  const mock: MockPluginContext = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    settings:
      options.url === undefined
        ? { url: "https://c.example.test" }
        : { url: options.url },
    kv: options.cursor ? { [CURSOR_KEY]: options.cursor } : {},
    auditEntries: options.stored,
    fetch: (async (_url: string, init?: { body?: string }) => {
      const action = JSON.parse(String(init?.body)).action as string;
      const status = options.respond?.(action) ?? 200;
      if (status < 300) received.push(action);
      return new Response(null, { status });
    }) as never,
  });
  const relay = createRelay(mock.ctx, createForwarder(mock.ctx, {}));
  return { mock, relay, received };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("relay", () => {
  it("sends the entries written after the cursor, oldest first", async () => {
    const { relay, received, mock } = setup({
      stored: [line(1), line(2), line(3), line(4)],
      cursor: line(2).timestamp,
    });
    await relay.start();
    await settle();
    expect(received).toEqual(["action_3", "action_4"]);
    await relay.stop();
    expect(await mock.ctx.kv.get(CURSOR_KEY)).toBe(line(4).timestamp);
  });

  it("does not replay the log the first time", async () => {
    const { relay, received, mock } = setup({
      stored: [line(1), line(2)],
    });
    await relay.start();
    await settle();
    expect(received).toEqual([]);
    expect(typeof (await mock.ctx.kv.get(CURSOR_KEY))).toBe("string");
    await relay.stop();
  });

  it("does nothing without a collector", async () => {
    const { relay, received } = setup({
      stored: [line(1)],
      cursor: line(0).timestamp,
      url: "",
    });
    await relay.start();
    await settle();
    expect(received).toEqual([]);
    await relay.stop();
  });

  it("forwards live entries and moves the cursor", async () => {
    const { relay, received, mock } = setup({
      stored: [],
      cursor: line(0).timestamp,
    });
    await relay.start();
    await settle();
    await relay.onEntry(line(5));
    expect(received).toEqual(["action_5"]);
    await relay.stop();
    expect(await mock.ctx.kv.get(CURSOR_KEY)).toBe(line(5).timestamp);
  });

  it("keeps the cursor behind a failed entry and sends it on retry", async () => {
    let down = true;
    const { relay, received, mock } = setup({
      stored: [line(1), line(2)],
      cursor: line(0).timestamp,
      respond: () => (down ? 503 : 200),
    });
    await relay.start();
    await settle();
    expect(received).toEqual([]);
    await relay.stop();
    expect(await mock.ctx.kv.get(CURSOR_KEY)).toBe(line(0).timestamp);

    down = false;
    const again = createRelay(mock.ctx, createForwarder(mock.ctx, {}));
    await again.start();
    await settle();
    expect(received).toEqual(["action_1", "action_2"]);
    await again.stop();
  });

  it("retries a collector that was down while live", async () => {
    let down = true;
    const { relay, received } = setup({
      stored: [line(1)],
      cursor: line(0).timestamp,
      respond: () => (down ? 500 : 200),
    });
    await relay.start();
    await settle();
    await relay.onEntry(line(1));
    expect(received).toEqual([]);

    down = false;
    await relay.retry();
    expect(received).toEqual(["action_1"]);
    await relay.stop();
  });
});
