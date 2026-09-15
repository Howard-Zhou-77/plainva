import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, resolveOpenAction, toast, useStableHandler } from "@plainva/ui";
import type { IVaultAdapter } from "@plainva/core";
import type { Layout, TabItem } from "./usePaneLayout";
import { isVirtualPath } from "../components/graph/virtualPaths";
import { getWindowBus } from "../services/windowBus";
import { registerMainTabTarget, waitForTabDocument, type CapturedTabDocument, type TabTransfer, type TransferStatus } from "../services/tabTransfer";

function carriesDocument(path: string): boolean {
  return !isVirtualPath(path) && ["editor", "text"].includes(resolveOpenAction(path));
}

export function useTabTransferTarget(vaultPath: string | null, adapter: IVaultAdapter | null, ready: boolean, owner: boolean,
  adoptTab: (tab: TabItem) => void) {
  useEffect(() => {
    if (!owner || !ready || !vaultPath || !adapter) return;
    let alive = true;
    const off = registerMainTabTarget(vaultPath, async snapshot => {
      if (!isVirtualPath(snapshot.path) && !await adapter.exists(snapshot.path)) throw new Error("The transferred file moved or disappeared");
      if (!alive) throw new Error("The target vault closed");
      // No dedup routing: until acknowledgement the source owns this tab.
      adoptTab(snapshot.tab);
      if (snapshot.document) {
        const endpoint = await waitForTabDocument(vaultPath, snapshot.path);
        if (!alive) throw new Error("The target vault closed");
        await endpoint.adopt(snapshot.document, snapshot.id);
      } else await new Promise(resolve => setTimeout(resolve, 100));
      if (!alive) throw new Error("The target vault closed");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFocus().catch(() => {});
    });
    return () => { alive = false; off(); };
  }, [vaultPath, adapter, ready, owner, adoptTab]);
}

/** The source retains its buffer until the owner's receipt is confirmed. */
export function useTabTransferSource(vaultPath: string | null, label: string | null, layout: Layout,
  selectTab: (pane: number, index: number) => void, closeTab: (pane: number, index: number) => void) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TransferStatus | "preparing" | null>(null);
  const pending = useRef<{ snapshot: TabTransfer; captured?: CapturedTabDocument; cancel: boolean; finished: boolean; sent: boolean } | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const settle = useStableHandler(async (next: TransferStatus) => {
    const current = pending.current;
    if (!current || current.finished) return;
    if (next === "accepted" || next === "failed" || next === "canceled") {
      current.finished = true;
      // Journal cleanup failing must not reverse an acknowledged transfer.
      await current.captured?.finish(next === "accepted").catch(() => {});
      if (next === "accepted") {
        layout.panes.some((pane, paneIndex) => {
          const index = pane.tabs.findIndex(tab => tab.history[tab.historyIndex] === current.snapshot.path);
          if (index < 0) return false;
          closeTab(paneIndex, index); return true;
        });
        pending.current = null;
        if (mounted.current) setStatus(null);
        return;
      }
      if (next === "canceled") pending.current = null;
    }
    if (mounted.current) setStatus(next === "canceled" ? null : next);
  });

  const check = useStableHandler(async () => {
    const current = pending.current;
    if (!current || current.finished || running.current) return;
    running.current = true;
    try {
      const bus = await getWindowBus();
      const options = { vaultPath: current.snapshot.vaultPath };
      const result = current.cancel
        ? await bus.request("tab-transfer-cancel", { id: current.snapshot.id }, options)
        : current.sent ? await bus.request("tab-transfer-status", { id: current.snapshot.id }, options)
          : await bus.request("tab-transfer-begin", current.snapshot, options);
      current.sent = true;
      await settle(result.status);
    } catch { if (mounted.current) setStatus("unknown"); }
    finally { running.current = false; }
  });

  const start = useStableHandler(async (pane: number, index: number) => {
    if (!vaultPath || !label || pending.current) return;
    const tab = layout.panes[pane]?.tabs[index];
    const path = tab?.history[tab.historyIndex];
    if (!tab || !path) return;
    setStatus("preparing");
    const current = { snapshot: { id: crypto.randomUUID(), source: label, vaultPath, path, tab: structuredClone(tab) } as TabTransfer,
      captured: undefined as CapturedTabDocument | undefined, cancel: false, finished: false, sent: false };
    pending.current = current;
    try {
      selectTab(pane, index);
      if (carriesDocument(path)) {
        const endpoint = await waitForTabDocument(vaultPath, path);
        current.captured = await endpoint.capture();
        current.snapshot.document = current.captured.document;
      }
      await check();
    } catch {
      await current.captured?.finish(false).catch(() => {});
      pending.current = null;
      if (mounted.current) { setStatus(null); toast.error(t("window.transferFailed")); }
    }
  });

  const cancel = useStableHandler(() => {
    const current = pending.current;
    if (!current || current.finished) { pending.current = null; setStatus(null); return; }
    current.cancel = true;
    if (status !== "preparing") void check();
  });
  useEffect(() => {
    if (!status || status === "preparing" || status === "failed") return;
    const timer = window.setInterval(() => { void check(); }, 1500);
    return () => window.clearInterval(timer);
  }, [status, check]);
  useEffect(() => {
    if (!status) return;
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ["w", "s", "o", "e"].includes(event.key.toLowerCase()) || event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [status]);

  return { start, busy: status !== null, modal: status ? (
    <Modal title={t("window.returnToMain")} onClose={cancel} closeOnOverlay={false} hideClose testId="tab-transfer" size="sm"
      footer={<><Button onClick={cancel}>{status === "failed" ? t("common.close") : t("common.cancel")}</Button>
        {status === "unknown" && <Button onClick={() => { void check(); }}>{t("window.transferCheck")}</Button>}</>}>
      <p role="status">{t(status === "failed" ? "window.transferFailed" : status === "unknown" ? "window.transferUnknown" : "window.transferPending")}</p>
    </Modal>
  ) : null };
}
