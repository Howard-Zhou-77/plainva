import { useEffect, useState } from "react";
import { PERSONAL_DESIGN_EVENT, type PersonalDesignSync, type PersonalDesignStatus } from "../lib/personalDesignSync";
import type { CustomThemeDesign } from "../lib/customThemeDesign";

export function usePersonalDesignSync(load: (() => Promise<PersonalDesignSync>) | null, refreshLocal: () => void) {
  const [controller, setController] = useState<PersonalDesignSync | null>(null);
  const [status, setStatus] = useState<PersonalDesignStatus | null>(null);
  const [failed, setFailed] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true, current: PersonalDesignSync | null = null;
    setController(null); setStatus(null); setFailed(false);
    const refresh = () => {
      if (current) void current.read().then(next => { if (live) { setStatus(next); refreshLocal(); } }).catch(() => { if (live) setFailed(true); });
    };
    if (load) void load().then(async value => {
      current = value;
      const next = await value.read();
      if (live) { setController(value); setStatus(next); refreshLocal(); }
    }).catch(() => { if (live) setFailed(true); });
    window.addEventListener(PERSONAL_DESIGN_EVENT, refresh);
    return () => { live = false; window.removeEventListener(PERSONAL_DESIGN_EVENT, refresh); };
  }, [load, refreshLocal]);

  const run = async (work: () => Promise<PersonalDesignStatus>, reportFailure = true) => {
    setBusy(true); setFailed(false);
    try { setStatus(await work()); refreshLocal(); }
    catch (error) { if (reportFailure) setFailed(true); throw error; }
    finally { setBusy(false); }
  };
  return {
    status, failed, busy, available: !!controller,
    setEnabled: (enabled: boolean) => { if (controller) void run(() => controller.setEnabled(enabled)).catch(() => {}); },
    choose: (design: CustomThemeDesign) => { if (controller) void run(() => controller.save(design, status?.profile ?? null)).catch(() => {}); },
    save: async (design: CustomThemeDesign, fallback: () => Promise<void>) => {
      if (controller) await run(() => controller.save(design, status?.profile ?? null), false);
      else await fallback();
    },
  };
}
