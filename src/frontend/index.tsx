import { useState } from "react";
import {
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { Button } from "@termix-ssh/plugin-sdk/ui";
import { toast } from "sonner";

const SLOT_ID = "audit.toolbar";

type Format = "csv" | "ndjson";

interface ExportFilters {
  userId?: string;
  action?: string;
  resourceType?: string;
  success?: boolean;
  startDate?: string;
  endDate?: string;
}

/** Query string for the export route; empty filters are left out. */
export function exportQuery(format: Format, filters: ExportFilters): string {
  const params = new URLSearchParams({ format });
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function filenameFrom(disposition: unknown, format: Format): string {
  const match = /filename="([^"]+)"/.exec(String(disposition ?? ""));
  return match?.[1] ?? `termix-audit.${format}`;
}

function createExportButtons(app: TermixApp) {
  return function ExportButtons(props: Record<string, unknown>) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const filters = (props.filters ?? {}) as ExportFilters;

    const run = async (format: Format) => {
      setBusy(true);
      try {
        const response = (await app.api.get(
          `/export?${exportQuery(format, filters)}`,
          { responseType: "blob" },
        )) as { data: Blob; headers?: Record<string, unknown> };
        const url = URL.createObjectURL(response.data);
        const link = document.createElement("a");
        link.href = url;
        link.download = filenameFrom(
          response.headers?.["content-disposition"],
          format,
        );
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch {
        toast.error(t("export.error"));
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px]"
          disabled={busy}
          onClick={() => void run("csv")}
        >
          {t("export.csv")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px]"
          disabled={busy}
          onClick={() => void run("ndjson")}
        >
          {t("export.ndjson")}
        </Button>
      </div>
    );
  };
}

export function activate(app: TermixApp): void {
  app.registerSlotContribution(SLOT_ID, {
    actionId: "audit-tools.export",
    titleKey: "export.title",
    kind: "component",
    component: createExportButtons(app),
  });
}
