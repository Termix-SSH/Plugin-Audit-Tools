import { describe, expect, it, vi } from "vitest";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginAuditEntry } from "@termix-ssh/plugin-sdk/backend";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import {
  createForwarder,
  forwardPayload,
} from "../../src/backend/forwarder.js";

const manifest = manifestJson as unknown as PluginManifest;

const entry: PluginAuditEntry = {
  timestamp: "2026-10-18T10:00:00.000Z",
  userId: "u1",
  username: "root",
  action: "login",
  resourceType: "user",
  resourceId: null,
  resourceName: null,
  details: "x",
  ipAddress: null,
  userAgent: null,
  success: true,
  errorMessage: null,
};

function build(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  settings: Record<string, unknown> = {},
): MockPluginContext {
  return createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    settings,
    fetch: fetch as never,
  });
}

describe("forward target", () => {
  it("is off with no url", async () => {
    const mock = build(async () => new Response(null, { status: 200 }));
    const forwarder = createForwarder(mock.ctx, {});
    expect(await forwarder.target()).toBeNull();
    expect(await forwarder.forward(entry)).toBe(false);
    expect(mock.fetches).toHaveLength(0);
  });

  it("uses the environment when no url is set", async () => {
    const mock = build(async () => new Response(null, { status: 200 }));
    const forwarder = createForwarder(mock.ctx, {
      AUDIT_LOG_FORWARD_URL: " https://env.example.test/in ",
      AUDIT_LOG_FORWARD_TOKEN: "env-token",
    });
    expect(await forwarder.target()).toEqual({
      url: "https://env.example.test/in",
      token: "env-token",
    });
  });

  it("lets the settings url win and use the settings token", async () => {
    const mock = build(async () => new Response(null, { status: 200 }), {
      url: "https://set.example.test/in",
      token: "set-token",
    });
    const forwarder = createForwarder(mock.ctx, {
      AUDIT_LOG_FORWARD_URL: "https://env.example.test/in",
      AUDIT_LOG_FORWARD_TOKEN: "env-token",
    });
    expect(await forwarder.target()).toEqual({
      url: "https://set.example.test/in",
      token: "set-token",
    });
  });

  it("does not send the env token to a settings url", async () => {
    const mock = build(async () => new Response(null, { status: 200 }), {
      url: "https://set.example.test/in",
    });
    const forwarder = createForwarder(mock.ctx, {
      AUDIT_LOG_FORWARD_TOKEN: "env-token",
    });
    expect(await forwarder.target()).toEqual({
      url: "https://set.example.test/in",
    });
  });
});

describe("forward", () => {
  it("posts one ndjson line with the bearer token", async () => {
    const mock = build(async () => new Response(null, { status: 200 }), {
      url: "https://set.example.test/in",
      token: "secret",
    });
    const forwarder = createForwarder(mock.ctx, {});

    expect(await forwarder.forward(entry)).toBe(true);

    const [call] = mock.fetches;
    expect(call.url).toBe("https://set.example.test/in");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.headers).toMatchObject({
      "Content-Type": "application/x-ndjson",
      Authorization: "Bearer secret",
    });
    expect(call.init?.timeoutMs).toBe(5000);
    const body = String(call.init?.body);
    expect(body.endsWith("\n")).toBe(true);
    expect(JSON.parse(body)).toEqual(forwardPayload(entry));
  });

  it("reports a non 2xx answer and a thrown error without throwing", async () => {
    const down = build(async () => new Response(null, { status: 503 }), {
      url: "https://set.example.test/in",
    });
    expect(await createForwarder(down.ctx, {}).forward(entry)).toBe(false);

    const broken = build(
      async () => {
        throw new Error("refused");
      },
      { url: "https://set.example.test/in" },
    );
    expect(await createForwarder(broken.ctx, {}).forward(entry)).toBe(false);
  });

  it("goes quiet after repeated failures and reports recovery", async () => {
    let ok = false;
    const mock = build(
      async () => new Response(null, { status: ok ? 200 : 500 }),
      { url: "https://set.example.test/in" },
    );
    const warn = vi.spyOn(mock.ctx.log, "warn");
    const info = vi.spyOn(mock.ctx.log, "info");
    const forwarder = createForwarder(mock.ctx, {});

    for (let i = 0; i < 8; i++) await forwarder.forward(entry);
    // Five failures log, plus one "suppressing" line, then silence.
    expect(warn).toHaveBeenCalledTimes(6);

    ok = true;
    await forwarder.forward(entry);
    expect(info).toHaveBeenCalledTimes(1);
  });
});
