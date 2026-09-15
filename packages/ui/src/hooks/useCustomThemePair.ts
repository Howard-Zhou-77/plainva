import { useState } from "react";
import { proposeCustomThemeMood, withCustomThemeMood, type CustomThemeDesign } from "../lib/customThemeDesign";
import type { CustomThemeMode, CustomThemeSpec } from "../lib/customTheme";

/** Shared draft boundary: an unadopted mood never reaches persisted appearance. */
export function useCustomThemePair(design: CustomThemeDesign, onChange: (design: CustomThemeDesign) => void | Promise<void>) {
  const [mode, setMode] = useState<CustomThemeMode>(() => design.light ? "light" : "dark");
  const [drafts, setDrafts] = useState<Partial<Record<CustomThemeMode, CustomThemeSpec>>>({});
  const [saveFailed, setSaveFailed] = useState(false);
  const pending = design[mode] === null;
  const spec = design[mode] ?? drafts[mode] ?? proposeCustomThemeMood(design, mode);
  const commit = async (next: CustomThemeSpec) => {
    setSaveFailed(false);
    try { await onChange(withCustomThemeMood(design, next)); }
    catch { setSaveFailed(true); }
  };
  const update = (next: CustomThemeSpec) => {
    if (design[next.mode]) void commit(next);
    else setDrafts(current => ({ ...current, [next.mode]: next }));
  };
  return { mode, setMode, spec, pending, saveFailed, update, adopt: () => { void commit(spec); } };
}
