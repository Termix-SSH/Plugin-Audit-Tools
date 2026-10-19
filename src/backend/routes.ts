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
}
