import { clampCustomTheme, defaultCustomTheme, parseCustomTheme, type CustomThemeMode, type CustomThemeRadius, type CustomThemeSpec } from "./customTheme";
import { hexToHsl, hslToHex, normalizeHex } from "./contrast";

/** Device settings v2. Null means a mood has not been adopted, not a default. */
export interface CustomThemeDesign {
  version: 2;
  radius: CustomThemeRadius;
  light: CustomThemeSpec | null;
  dark: CustomThemeSpec | null;
}

export function defaultCustomThemeDesign(): CustomThemeDesign {
  return { version: 2, radius: "normal", light: defaultCustomTheme(), dark: null };
}

/** Reading the legacy shape preserves its one mood; it never adopts another. */
export function parseCustomThemeDesign(raw: unknown): CustomThemeDesign | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.version === undefined) {
    const legacy = parseCustomTheme(raw);
    return legacy ? { version: 2, radius: legacy.radius, light: legacy.mode === "light" ? legacy : null, dark: legacy.mode === "dark" ? legacy : null } : null;
  }
  if (value.version !== 2 || !["sharp", "normal", "soft"].includes(String(value.radius))) return null;
  const radius = value.radius as CustomThemeRadius;
  const mood = (mode: CustomThemeMode): CustomThemeSpec | null | false => {
    const rawSpec = value[mode];
    if (rawSpec === null) return null;
    if (!rawSpec || typeof rawSpec !== "object" || Array.isArray(rawSpec)) return false;
    const fields = rawSpec as Record<string, unknown>;
    if (fields.mode !== mode || typeof fields.background !== "string" || !normalizeHex(fields.background) || typeof fields.accent !== "string" || !normalizeHex(fields.accent)) return false;
    const spec = parseCustomTheme(fields);
    return spec ? { ...spec, radius } : false;
  };
  const light = mood("light"), dark = mood("dark");
  if (light === false || dark === false || (!light && !dark)) return null;
  return { version: 2, radius, light, dark };
}

export function customThemeModes(design: CustomThemeDesign): CustomThemeMode[] {
  return (["light", "dark"] as const).filter(mode => design[mode] !== null);
}

/** With one adopted mood, preserve the old pinned appearance until approval. */
export function customThemeSpecForMode(design: CustomThemeDesign, mode: CustomThemeMode): CustomThemeSpec {
  return design[mode] ?? design.light ?? design.dark ?? defaultCustomTheme(mode);
}

/** A preview only: callers must explicitly adopt it before persisting. */
export function proposeCustomThemeMood(design: CustomThemeDesign, mode: CustomThemeMode): CustomThemeSpec {
  if (design[mode]) return { ...design[mode] };
  const existing = customThemeSpecForMode(design, mode), hue = hexToHsl(existing.background);
  return clampCustomTheme({ ...defaultCustomTheme(mode), radius: design.radius, accent: existing.accent,
    background: hslToHex({ ...hue, l: mode === "light" ? 0.97 : 0.08 }) }).spec;
}

/** A local edit/adoption. Only explicit radius changes affect the other mood. */
export function withCustomThemeMood(design: CustomThemeDesign, input: CustomThemeSpec): CustomThemeDesign {
  const spec = clampCustomTheme(input).spec;
  return {
    version: 2,
    radius: spec.radius,
    light: spec.mode === "light" ? spec : design.light ? { ...design.light, radius: spec.radius } : null,
    dark: spec.mode === "dark" ? spec : design.dark ? { ...design.dark, radius: spec.radius } : null,
  };
}
