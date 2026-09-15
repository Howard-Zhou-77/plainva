// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SettingsSyncStep, type IVaultAdapter } from "@plainva/core";
import { PersonalDesignSync, canonicalizeProfileValues, defaultCustomTheme, defaultCustomThemeDesign, isMemberProfileField, mergePersonalDesignValues, personalDesignScope, reviseCustomThemeProfile, withCustomThemeMood, type CustomThemeDesign, type ISettingsStore } from "@plainva/ui";
import { CountingSyncTarget, MemoryProfileVault } from "../../../packages/core/test/support/settingsSyncHarness";

function device(id: string, initial = defaultCustomThemeDesign()) {
  const map = new Map<string, unknown>([["personalDesignDevice", id]]);
  const state = { design: structuredClone(initial), failApply: false };
  const store: ISettingsStore = {
    async get<T>(key: string) { return structuredClone(map.get(key)) as T | undefined; },
    async set(key, value) { map.set(key, structuredClone(value)); },
    async delete(key) { return map.delete(key); }, async keys() { return [...map.keys()]; }, async save() {},
  };
  const controller = (vault = "vault", member: string | null = null) => new PersonalDesignSync(store, personalDesignScope(vault, member), vault,
    async () => structuredClone(state.design), async value => { if (state.failApply) throw new Error("disk full"); state.design = structuredClone(value); });
  return { state, store, controller };
}
const alternate = () => withCustomThemeMood(defaultCustomThemeDesign(), defaultCustomTheme("dark"));

describe("personal design persistence and opt-in", () => {
  it("retains incoming variants while off without changing local appearance", async () => {
    const d = device("a"), c = d.controller(), incoming = reviseCustomThemeProfile(null, "remote", alternate());
    await c.receive(incoming);
    expect(d.state.design).toEqual(defaultCustomThemeDesign());
    expect((await c.read()).enabled).toBe(false); expect(await c.export()).toEqual(incoming);
    await c.setEnabled(true); expect(d.state.design).toEqual(alternate());
    expect(await c.export()).toEqual(incoming);
    await c.setEnabled(false);
    await c.receive(reviseCustomThemeProfile(incoming, "remote", defaultCustomThemeDesign()));
    expect(d.state.design).toEqual(alternate());
  });
  it("binds one vault and member and cannot impose another member's design", async () => {
    const d = device("a"), own = d.controller("vault", "alice"), other = d.controller("vault", "bob"), another = d.controller("other", "alice");
    await own.setEnabled(true);
    const remote = reviseCustomThemeProfile(null, "remote", alternate());
    await other.receive(remote); await another.receive(remote);
    expect(d.state.design).toEqual(defaultCustomThemeDesign());
    expect((await own.read()).enabled).toBe(true); expect((await other.read()).enabled).toBe(false);
    await another.setEnabled(true); expect(d.state.design).toEqual(alternate());
    expect((await own.read()).enabled).toBe(false); expect((await another.read()).sourceLabel).toBe("other");
  });
  it("replays an acknowledged register after the local appearance write fails", async () => {
    const d = device("a"), c = d.controller();
    await c.setEnabled(true);
    const initial = await c.export(), incoming = reviseCustomThemeProfile(initial, "remote", alternate());
    d.state.failApply = true;
    await expect(c.receive(incoming)).rejects.toThrow("disk full");
    expect(d.state.design).toEqual(defaultCustomThemeDesign());
    d.state.failApply = false;
    const reopened = d.controller();
    expect((await reopened.read()).profile).toEqual(incoming);
    expect(d.state.design).toEqual(alternate());
  });
  it("keeps an unseen remote change when a stale editor saves, then resolves explicitly", async () => {
    const d = device("a"), c = d.controller(); await c.setEnabled(true);
    const baseline = await c.export();
    await c.receive(reviseCustomThemeProfile(baseline, "remote", alternate()));
    await c.save(defaultCustomThemeDesign(), baseline);
    const conflict = (await c.read()).profile!;
    expect(conflict.variants).toHaveLength(2);
    await c.save(alternate(), conflict);
    expect((await c.read()).profile!.variants).toHaveLength(1); expect(d.state.design).toEqual(alternate());
  });
  it("refuses malformed input without erasing the last confirmed design", async () => {
    const d = device("a"), c = d.controller(); await c.setEnabled(true);
    const initial = await c.export();
    await expect(c.receive({ version: 4, variants: [] })).rejects.toThrow("profile_invalid");
    await c.receive(undefined); expect(await c.export()).toEqual(initial);
    expect(() => mergePersonalDesignValues([{ personalDesign: { version: 4 } }])).toThrow("profile_invalid");
  });
});

describe("personal designs through the actual profile transport", () => {
  function wire(d: ReturnType<typeof device>, id: string, memberId?: string) {
    const c = d.controller("vault", memberId ?? null), vault = new MemoryProfileVault();
    const step = new SettingsSyncStep({ deviceId: id, memberId, isMemberField: isMemberProfileField, now: () => "2026-09-14T12:00:00.000Z", port: {
      normalizeValues: canonicalizeProfileValues, mergeObservedValues: mergePersonalDesignValues,
      async exportValues() { const profile = await c.export(); return profile ? { personalDesign: profile } : {}; },
      async applyValues(values) { await c.receive(values.personalDesign); },
    } });
    return { c, run: (target: CountingSyncTarget) => step.run(target, vault as unknown as IVaultAdapter) };
  }
  it("joins first participation and concurrent edits, converges and stops uploading", async () => {
    const target = new CountingSyncTarget(), a = wire(device("a"), "a"), b = wire(device("b", alternate()), "b");
    await a.c.setEnabled(true); await b.c.setEnabled(true);
    await a.run(target); await b.run(target); await a.run(target);
    const initial = (await a.c.read()).profile!;
    expect(initial.variants).toHaveLength(2); expect((await b.c.read()).profile).toEqual(initial);
    await a.c.save(alternate(), initial); await a.run(target); await b.run(target);
    const baseline = (await a.c.read()).profile!;
    const soft: CustomThemeDesign = withCustomThemeMood(alternate(), { ...alternate().light!, radius: "soft" });
    await a.c.save(defaultCustomThemeDesign(), baseline); await b.c.save(soft, baseline);
    await b.run(target); await a.run(target); await b.run(target);
    const conflict = (await a.c.read()).profile!;
    expect(conflict.variants).toHaveLength(2); expect((await b.c.read()).profile).toEqual(conflict);
    await b.c.save(soft, conflict); await b.run(target); await a.run(target); await b.run(target);
    expect((await a.c.read()).profile!.variants).toHaveLength(1);
    const count = target.profileUploads;
    for (let i = 0; i < 4; i++) { await a.run(target); await b.run(target); }
    expect(target.profileUploads).toBe(count);
  });
  it("publishes only into the owning member partition", async () => {
    const target = new CountingSyncTarget(), a = wire(device("a"), "a", "alice"), bDevice = device("b", alternate()), b = wire(bDevice, "b", "bob");
    await a.c.setEnabled(true); await a.run(target); await b.run(target);
    expect(await b.c.export()).toBeNull(); expect(bDevice.state.design).toEqual(alternate());
    const paths = [...target.remote.keys()];
    expect(paths).toHaveLength(1); expect(paths[0]).toContain("alice");
  });
});
