import type {
  PluginAuditEntry,
  PluginContext,
} from "@termix-ssh/plugin-sdk/backend";
import type { Forwarder } from "./forwarder.js";

export const CURSOR_KEY = "forwardedUntil";
/** Entries sent per catch up run. The next run carries on from there. */
export const MAX_CATCH_UP = 5000;
const SAVE_DELAY_MS = 5000;

/**
 * Keeps the collector complete. Live entries arrive through the audit hook;
 * the cursor remembers the time of the last entry the collector has, so
 * entries written while Termix or the collector was down are sent later from
 * the stored audit log, oldest first.
 */
export function createRelay(ctx: PluginContext, forwarder: Forwarder) {
  let cursor: string | null = null;
  let dirty = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let behind = false;
  let running: Promise<void> | null = null;
  let stopped = false;
  let loaded = false;

  async function save(): Promise<void> {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty || cursor === null) return;
    dirty = false;
    await ctx.kv.set(CURSOR_KEY, cursor);
  }

  function advance(timestamp: string): void {
    if (cursor === null || timestamp > cursor) {
      cursor = timestamp;
      dirty = true;
      if (!saveTimer) {
        saveTimer = setTimeout(
          () => void save().catch(() => {}),
          SAVE_DELAY_MS,
        );
      }
    }
  }

  async function catchUp(): Promise<void> {
    if (running) return running;
    running = (async () => {
      const target = await forwarder.target();
      if (!target || cursor === null || stopped) return;
      let sent = 0;
      try {
        for await (const batch of ctx.audit.exportBatches({
          startDate: cursor,
        })) {
          for (const entry of batch) {
            if (stopped) return;
            if (cursor !== null && entry.timestamp <= cursor) continue;
            if (!(await forwarder.forward(entry, target))) {
              behind = true;
              return;
            }
            advance(entry.timestamp);
            if (++sent >= MAX_CATCH_UP) {
              behind = true;
              return;
            }
          }
        }
        behind = false;
      } finally {
        await save().catch(() => {});
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    async start(): Promise<void> {
      // Read once: a settings change calls this again and must not wind the
      // cursor back to what was last saved.
      if (!loaded) {
        loaded = true;
        const stored = await ctx.kv.get(CURSOR_KEY);
        cursor = typeof stored === "string" ? stored : null;
      }
      // The first run starts from now; the existing log is not replayed.
      if (cursor === null && (await forwarder.target())) {
        cursor = new Date().toISOString();
        dirty = true;
        await save();
      }
      void catchUp().catch(() => {});
    },

    async onEntry(entry: PluginAuditEntry): Promise<void> {
      const target = await forwarder.target();
      if (!target) return;
      if (cursor === null) {
        // Forwarding was just turned on: start from this entry.
        cursor = new Date(Date.parse(entry.timestamp) - 1).toISOString();
      }
      // While behind, the stored log is the ordered source of truth.
      if (behind || running) {
        behind = true;
        void catchUp().catch(() => {});
        return;
      }
      if (await forwarder.forward(entry, target)) {
        advance(entry.timestamp);
      } else {
        behind = true;
      }
    },

    /** A periodic nudge so a recovered collector gets what it missed. */
    async retry(): Promise<void> {
      if (behind) await catchUp();
    },

    async stop(): Promise<void> {
      stopped = true;
      await save().catch(() => {});
    },
  };
}

export type Relay = ReturnType<typeof createRelay>;
