import type {
  PluginAuditEntry,
  PluginContext,
} from "@termix-ssh/plugin-sdk/backend";

export const FORWARD_URL_ENV = "AUDIT_LOG_FORWARD_URL";
export const FORWARD_TOKEN_ENV = "AUDIT_LOG_FORWARD_TOKEN";

/**
 * How many failures in a row before the forwarder stops logging each one. It
 * keeps trying, this only quiets the log, and it reports again once delivery
 * recovers.
 */
const QUIET_AFTER_FAILURES = 5;

export interface ForwardTarget {
  url: string;
  token?: string;
}

/** The wire shape: one JSON object per entry, matching the NDJSON export. */
export function forwardPayload(
  entry: PluginAuditEntry,
): Record<string, unknown> {
  return {
    timestamp: entry.timestamp,
    userId: entry.userId,
    username: entry.username,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    resourceName: entry.resourceName ?? null,
    success: entry.success,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    errorMessage: entry.errorMessage ?? null,
    details: entry.details ?? null,
  };
}

export function createForwarder(
  ctx: PluginContext,
  env: NodeJS.ProcessEnv = process.env,
) {
  let consecutiveFailures = 0;
  let quietened = false;

  /** A collector set in settings wins over the deployment variable. */
  async function target(): Promise<ForwardTarget | null> {
    const settingUrl = String(
      (await ctx.settings.get<string>("url")) ?? "",
    ).trim();
    const url = settingUrl || env[FORWARD_URL_ENV]?.trim();
    if (!url) return null;
    const token = settingUrl
      ? String((await ctx.settings.get<string>("token")) ?? "").trim()
      : env[FORWARD_TOKEN_ENV]?.trim();
    return token ? { url, token } : { url };
  }

  function noteFailure(reason: string, action: string): void {
    consecutiveFailures++;
    if (quietened) return;
    ctx.log.warn(
      `Failed to forward audit entry (${action}): ${reason} [${consecutiveFailures} in a row]`,
    );
    if (consecutiveFailures >= QUIET_AFTER_FAILURES) {
      quietened = true;
      ctx.log.warn(
        `Audit forwarding has failed ${consecutiveFailures} times, so further messages are hidden until it recovers`,
      );
    }
  }

  function noteSuccess(): void {
    if (quietened) {
      ctx.log.info(
        `Audit forwarding recovered after ${consecutiveFailures} failures`,
      );
    }
    consecutiveFailures = 0;
    quietened = false;
  }

  /**
   * Ships one entry. Never throws: a collector being down must not break the
   * plugin, and Termix keeps its own copy. Delivery goes through ctx.fetch,
   * which refuses private addresses, so a bad URL cannot probe the network.
   */
  async function forward(
    entry: PluginAuditEntry,
    to?: ForwardTarget | null,
  ): Promise<boolean> {
    const destination = to === undefined ? await target() : to;
    if (!destination) return false;

    try {
      const response = await ctx.fetch(destination.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-ndjson",
          ...(destination.token
            ? { Authorization: `Bearer ${destination.token}` }
            : {}),
        },
        body: `${JSON.stringify(forwardPayload(entry))}\n`,
        timeoutMs: 5000,
      });
      // The body is not needed; free the connection.
      void response.body?.cancel().catch(() => {});

      if (!response.ok) {
        noteFailure(`collector returned ${response.status}`, entry.action);
        return false;
      }
      noteSuccess();
      return true;
    } catch (error) {
      noteFailure(
        error instanceof Error ? error.message : String(error),
        entry.action,
      );
      return false;
    }
  }

  return { target, forward };
}

export type Forwarder = ReturnType<typeof createForwarder>;
