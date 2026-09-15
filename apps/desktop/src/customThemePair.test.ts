// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyResolved, customThemeColors, customThemeModes, defaultCustomTheme, defaultCustomThemeDesign, isModePinned, mergeCustomThemeProfiles, parseCustomThemeDesign, parseCustomThemeProfile, proposeCustomThemeMood, resolveThemeMode, reviseCustomThemeProfile, setCustomTheme, withCustomThemeMood } from "@plainva/ui";

afterEach(() => setCustomTheme(null));
describe("paired personal design", () => {
  it("migrates exactly the saved mood and requires adoption for its counterpart", () => {
    const legacy = { ...defaultCustomTheme("dark"), radius: "soft" as const };
    const design = parseCustomThemeDesign(legacy)!;
    expect(design.dark).toEqual(legacy); expect(design.light).toBeNull();
    const proposal = proposeCustomThemeMood(design, "light");
    expect(design.light).toBeNull(); expect(customThemeColors(proposal).textMain).not.toBe(proposal.background);
    setCustomTheme(design); expect(isModePinned("custom")).toBe(true); expect(resolveThemeMode("light", "custom")).toBe("dark");
    const accepted = withCustomThemeMood(design, proposal);
    expect(accepted.dark).toEqual(legacy); expect(customThemeModes(accepted)).toEqual(["light", "dark"]);
    expect(parseCustomThemeDesign(accepted)).toEqual(accepted);
  });
  it("applies both saved moods and preserves independent colours", () => {
    const light = defaultCustomThemeDesign(), pair = withCustomThemeMood(light, defaultCustomTheme("dark"));
    setCustomTheme(pair); expect(isModePinned("custom")).toBe(false);
    applyResolved("dark", "custom"); expect(document.documentElement.style.getPropertyValue("--bg-primary")).toBe(pair.dark!.background);
    applyResolved("light", "custom"); expect(document.documentElement.style.getPropertyValue("--bg-primary")).toBe(pair.light!.background);
    const changed = withCustomThemeMood(pair, { ...pair.dark!, accent: "#eeaacc", radius: "sharp" });
    expect(changed.light!.accent).toBe(pair.light!.accent); expect(changed.light!.radius).toBe("sharp");
  });
  it("rejects unknown versions, missing adopted moods and malformed colours", () => {
    expect(parseCustomThemeDesign({ version: 3 })).toBeNull();
    expect(parseCustomThemeDesign({ version: 2, radius: "normal", light: null, dark: null })).toBeNull();
    const design = defaultCustomThemeDesign(); design.light!.accent = "url(https://invalid.test)";
    expect(parseCustomThemeDesign(design)).toBeNull();
  });
});

describe("personal design convergence", () => {
  const first = () => reviseCustomThemeProfile(null, "device-a", defaultCustomThemeDesign());
  it("keeps concurrent edits in either delivery order and survives replay", () => {
    const baseline = first(), design = withCustomThemeMood(defaultCustomThemeDesign(), defaultCustomTheme("dark"));
    const a = reviseCustomThemeProfile(baseline, "device-a", design);
    const b = reviseCustomThemeProfile(baseline, "device-b", withCustomThemeMood(design, { ...design.light!, radius: "soft" }));
    const merged = mergeCustomThemeProfiles(a, b)!;
    expect(merged.variants).toHaveLength(2);
    expect(mergeCustomThemeProfiles(b, a)).toEqual(merged);
    expect(mergeCustomThemeProfiles(merged, baseline)).toEqual(merged);
    expect(mergeCustomThemeProfiles(merged, merged)).toEqual(merged);
    const chosen = reviseCustomThemeProfile(merged, "device-a", b.variants[0].design);
    expect(mergeCustomThemeProfiles(merged, chosen)).toEqual(chosen);
    expect(parseCustomThemeProfile(JSON.parse(JSON.stringify(chosen)))).toEqual(chosen);
  });
  it("does not hide an unseen remote edit behind a stale editor save", () => {
    const baseline = first(), remote = reviseCustomThemeProfile(baseline, "device-b", withCustomThemeMood(defaultCustomThemeDesign(), defaultCustomTheme("dark")));
    const staleEdit = reviseCustomThemeProfile(baseline, "device-a", defaultCustomThemeDesign());
    expect(mergeCustomThemeProfiles(remote, staleEdit)!.variants).toHaveLength(2);
  });
  it("rejects conflicting copies of one revision and invalid causal clocks", () => {
    const a = first(), b = structuredClone(a); b.variants[0].design.radius = "soft";
    expect(() => mergeCustomThemeProfiles(a, b)).toThrow("revision_collision");
    b.variants[0].clock["device-a"] = 0; expect(parseCustomThemeProfile(b)).toBeNull();
    expect(parseCustomThemeProfile({version:1,variants:[]})).toBeNull();
  });
});
