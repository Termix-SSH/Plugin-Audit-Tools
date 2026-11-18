import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  LoadingState,
  NoticePanel,
  PANEL,
  PanelFrame,
  PanelShell,
  RefreshButton,
  StatusBadge,
  TextAreaField,
} from "@termix-ssh/plugin-sdk/ui";
import {
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import type {
  PluginAuditChainResult,
  PluginAuditSavedHeadResult,
} from "@termix-ssh/plugin-sdk/backend";

/** Reads a pasted head: the downloaded file, or just its id and hash. */
export function readPastedHead(
  text: string,
): { id: number; hash: string } | null {
  try {
    const value = JSON.parse(text) as { id?: unknown; hash?: unknown };
    if (
      typeof value?.id === "number" &&
      Number.isInteger(value.id) &&
      typeof value.hash === "string" &&
      /^[0-9a-f]{64}$/.test(value.hash)
    ) {
      return { id: value.id, hash: value.hash };
    }
  } catch {
    // not JSON
  }
  return null;
}

function downloadHead(result: PluginAuditChainResult): void {
  if (!result.head) return;
  const body = JSON.stringify(
    { ...result.head, checkedAt: result.checkedAt, ok: result.ok },
    null,
    2,
  );
  const url = URL.createObjectURL(
    new Blob([body], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `termix-audit-head-${result.head.id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function createIntegrityTab(app: TermixApp) {
  return function IntegrityTab() {
    const { t } = useTranslation();
    const [result, setResult] = useState<PluginAuditChainResult | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [pasted, setPasted] = useState("");
    const [compared, setCompared] = useState<PluginAuditSavedHeadResult | null>(
      null,
    );

    const load = useCallback(async () => {
      setFailed(false);
      try {
        const response = (await app.api.get("/chain")) as {
          data: { result: PluginAuditChainResult | null };
        };
        setResult(response.data.result);
      } catch {
        setFailed(true);
      } finally {
        setLoaded(true);
      }
    }, []);

    useEffect(() => {
      void load();
    }, [load]);

    async function checkNow() {
      setBusy(true);
      try {
        const response = (await app.api.post("/chain/verify")) as {
          data: { result: PluginAuditChainResult };
        };
        setResult(response.data.result);
      } catch {
        toast.error(t("integrity.failed"));
      } finally {
        setBusy(false);
      }
    }

    async function compare() {
      const head = readPastedHead(pasted);
      if (!head) {
        toast.error(t("integrity.badHead"));
        return;
      }
      setBusy(true);
      try {
        const response = (await app.api.post("/chain/check-head", head)) as {
          data: { result: PluginAuditSavedHeadResult };
        };
        setCompared(response.data.result);
        setResult(response.data.result.chain);
      } catch {
        toast.error(t("integrity.failed"));
      } finally {
        setBusy(false);
      }
    }

    let status;
    if (!loaded) {
      status = <LoadingState />;
    } else if (failed) {
      status = <NoticePanel tone="destructive" title={t("integrity.failed")} />;
    } else if (!result) {
      status = <StatusBadge tone="idle">{t("integrity.never")}</StatusBadge>;
    } else {
      status = (
        <div className="flex flex-col gap-1">
          <div>
            <StatusBadge tone={result.ok ? "ok" : "bad"}>
              {result.ok
                ? t("integrity.ok")
                : t("integrity.broken", { id: result.brokenAt })}
            </StatusBadge>
          </div>
          {!result.ok && result.problem && (
            <p className="text-sm text-destructive">
              {t(`integrity.problem.${result.problem}`)}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {t("integrity.checked", {
              count: result.checked,
              unchained: result.unchained,
              time: new Date(result.checkedAt).toLocaleString(),
            })}
          </p>
          {result.head && (
            <p className="break-all font-mono text-xs text-muted-foreground">
              {t("integrity.head", {
                id: result.head.id,
                hash: result.head.hash,
              })}
            </p>
          )}
        </div>
      );
    }

    let comparison = null;
    if (compared) {
      const tone = compared.ok ? "ok" : compared.pruned ? "warn" : "bad";
      comparison = (
        <StatusBadge tone={tone}>
          {compared.ok
            ? t("integrity.headOk")
            : compared.pruned
              ? t("integrity.headPruned")
              : t("integrity.headMissing")}
        </StatusBadge>
      );
    }

    return (
      <PanelFrame>
        <PanelShell
          title={t("integrity.title")}
          actions={
            <>
              <RefreshButton onClick={() => void load()} loading={busy} />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !result?.head}
                onClick={() => result && downloadHead(result)}
              >
                {t("integrity.download")}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void checkNow()}>
                {t("integrity.checkNow")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col">
            <div
              className={`flex flex-col gap-3 border-b border-border ${PANEL.body}`}
            >
              <p className="text-sm text-muted-foreground">
                {t("integrity.intro")}
              </p>
              {status}
            </div>
            <div className={`flex flex-col gap-2 ${PANEL.body}`}>
              <TextAreaField
                label={t("integrity.paste")}
                value={pasted}
                onChange={setPasted}
                placeholder={t("integrity.pastePlaceholder")}
                rows={4}
                mono
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={busy || pasted.trim() === ""}
                  onClick={() => void compare()}
                >
                  {t("integrity.compare")}
                </Button>
                {comparison}
              </div>
            </div>
          </div>
        </PanelShell>
      </PanelFrame>
    );
  };
}
