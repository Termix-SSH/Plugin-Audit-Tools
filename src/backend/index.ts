import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { createForwarder } from "./forwarder.js";
import { createRelay } from "./relay.js";
import { registerRoutes } from "./routes.js";

/** How often a collector that was down is checked for entries it missed. */
const RETRY_INTERVAL_MS = 30_000;

export async function activate(ctx: PluginContext) {
  registerRoutes(ctx.http.router<Router>(), ctx);

  const forwarder = createForwarder(ctx);
  const relay = createRelay(ctx, forwarder);

  ctx.audit.subscribe((entry) => {
    void relay.onEntry(entry).catch(() => {});
  });
  ctx.schedule.every(RETRY_INTERVAL_MS, () => relay.retry());
  // Turning forwarding on or changing the collector sends what is waiting.
  ctx.settings.onChange("url", () => void relay.start().catch(() => {}));
  ctx.disposables.add(() => relay.stop());

  await relay.start();
}

export async function deactivate() {
  // Everything registered through ctx is disposed by core.
}
