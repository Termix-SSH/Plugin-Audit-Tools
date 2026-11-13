import type { Request, Response, Router } from "express";
import type {
  PluginAuditFilters,
  PluginContext,
} from "@termix-ssh/plugin-sdk/backend";
import { csvHeader, exportFilename, toCsvRows, toNdjson } from "./export.js";

export function filtersFromQuery(
  query: Record<string, unknown>,
): PluginAuditFilters {
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value !== "" ? value : undefined;
  const success = text(query.success);
  return {
    userId: text(query.userId),
    action: text(query.action),
    resourceType: text(query.resourceType),
    success: success === undefined ? undefined : success === "true",
    startDate: text(query.startDate),
    endDate: text(query.endDate),
  };
}

export function registerRoutes(router: Router, ctx: PluginContext): void {
  router.use(ctx.rbac.require("export") as never);

  /**
   * @openapi
   * /plugin-api/audit-tools/export:
   *   get:
   *     summary: Export the audit log
   *     description: Streams the audit log as CSV or NDJSON, oldest first. Admin only.
   *     tags:
   *       - Audit Tools
   *     parameters:
   *       - in: query
   *         name: format
   *         schema: { type: string, enum: [csv, ndjson], default: csv }
   *       - in: query
   *         name: userId
   *         schema: { type: string }
   *       - in: query
   *         name: action
   *         schema: { type: string }
   *       - in: query
   *         name: resourceType
   *         schema: { type: string }
   *       - in: query
   *         name: success
   *         schema: { type: string, enum: [true, false] }
   *       - in: query
   *         name: startDate
   *         schema: { type: string, format: date-time }
   *       - in: query
   *         name: endDate
   *         schema: { type: string, format: date-time }
   *     responses:
   *       200:
   *         description: The audit log file.
   *       403:
   *         description: Not allowed to export.
   *       500:
   *         description: Failed to export the audit log.
   */
  router.get("/export", async (req: Request, res: Response) => {
    const format = req.query.format === "ndjson" ? "ndjson" : "csv";
    const filters = filtersFromQuery(req.query as Record<string, unknown>);

    try {
      res.setHeader(
        "Content-Type",
        format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${exportFilename(format, new Date())}"`,
      );

      // Streamed in batches: an export is unbounded by definition.
      let exported = 0;
      if (format === "csv") res.write(csvHeader());
      for await (const batch of ctx.audit.exportBatches(filters, 500)) {
        res.write(format === "csv" ? toCsvRows(batch) : toNdjson(batch));
        exported += batch.length;
      }
      res.end();

      // Reading the whole trail is itself worth recording.
      await ctx.audit.record({
        action: "export_audit_logs",
        resourceType: "audit_log",
        details: JSON.stringify({ format, exported, filters }),
        success: true,
        request: req,
      });
    } catch (error) {
      ctx.log.error("Failed to export the audit log", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to export the audit log" });
        return;
      }
      res.end();
    }
  });

  /**
   * @openapi
   * /plugin-api/audit-tools/chain:
   *   get:
   *     summary: Last audit log check
   *     description: Core's last hourly check of the audit log's hash chain, or null before the first one. Needs the export permission.
   *     tags:
   *       - Audit Tools
   *     responses:
   *       200:
   *         description: The last check.
   *       403:
   *         description: Not allowed.
   */
  router.get("/chain", async (_req: Request, res: Response) => {
    try {
      res.json({ result: await ctx.audit.chain.status() });
    } catch (error) {
      ctx.log.error("Failed to read the audit log check", error);
      res.status(500).json({ error: "Failed to read the audit log check" });
    }
  });

  /**
   * @openapi
   * /plugin-api/audit-tools/chain/verify:
   *   post:
   *     summary: Check the audit log now
   *     description: Walks the whole hash chain and returns the result with the newest head.
   *     tags:
   *       - Audit Tools
   *     responses:
   *       200:
   *         description: The check result.
   *       403:
   *         description: Not allowed.
   */
  router.post("/chain/verify", async (_req: Request, res: Response) => {
    try {
      res.json({ result: await ctx.audit.chain.verify() });
    } catch (error) {
      ctx.log.error("Failed to check the audit log", error);
      res.status(500).json({ error: "Failed to check the audit log" });
    }
  });

  /**
   * @openapi
   * /plugin-api/audit-tools/chain/check-head:
   *   post:
   *     summary: Compare a saved head
   *     description: Says whether a head saved earlier still matches the audit log and the chain after it holds.
   *     tags:
   *       - Audit Tools
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [id, hash]
   *             properties:
   *               id: { type: integer }
   *               hash: { type: string }
   *     responses:
   *       200:
   *         description: The comparison.
   *       400:
   *         description: Not a head.
   *       403:
   *         description: Not allowed.
   */
  router.post("/chain/check-head", async (req: Request, res: Response) => {
    const head = parseHead(req.body);
    if (!head) {
      res.status(400).json({ error: "A head needs an id and a hash" });
      return;
    }
    try {
      res.json({ result: await ctx.audit.chain.checkHead(head) });
    } catch (error) {
      ctx.log.error("Failed to compare the saved head", error);
      res.status(500).json({ error: "Failed to compare the saved head" });
    }
  });
}

/** A saved head as pasted: { id, hash }, extra fields ignored. */
export function parseHead(body: unknown): { id: number; hash: string } | null {
  const value = body as { id?: unknown; hash?: unknown } | null;
  if (
    !value ||
    typeof value.id !== "number" ||
    !Number.isInteger(value.id) ||
    value.id < 1 ||
    typeof value.hash !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.hash)
  ) {
    return null;
  }
  return { id: value.id, hash: value.hash };
}
