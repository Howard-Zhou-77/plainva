// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BaseExportDialog } from "@plainva/ui";
import en from "../../../packages/ui/src/locales/en.json";

vi.mock("react-i18next", () => ({ useTranslation: () => ({
  t: (key: string, vars?: Record<string, unknown>) => {
    const value = key.split(".").reduce<any>((o,k) => o?.[k], en);
    return Object.entries(vars ?? {}).reduce((text,[k,v]) => text.replace(`{{${k}}}`,String(v)), value ?? key);
  },
}) }));
const mounted: { root: Root; host: HTMLDivElement }[] = [];
afterEach(async () => { for (const {root,host} of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); } });
async function mount(fn = "count", onExport = vi.fn(async () => true)) {
  const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host); mounted.push({root,host});
  const props = { config: {columns:{count:{rollup:{through:"links",of:"value",fn}}},views:[{order:["count"]}]}, viewIndex:0,
    rows:[{"file.path":"A.md",count:2}], onExport, onClose:vi.fn() };
  await act(async () => root.render(<BaseExportDialog {...props} />));
  const button = (name: string) => [...host.querySelectorAll("button")].find(el => el.textContent === name)!;
  return {host,root,props,button};
}
describe("shared database export chooser", () => {
  it("names an unsupported column, disables formulas, and only exports values after choosing CSV", async () => {
    const {host,props,button} = await mount("sum");
    expect(button(en.database.exportFormulas).disabled).toBe(true);
    expect(host.textContent).toContain(en.database.exportIssue_operation);
    expect(props.onExport).not.toHaveBeenCalled();
    await act(async () => button(en.database.exportValues).click());
    expect(props.onExport).toHaveBeenCalledWith(expect.objectContaining({extension:"csv"}));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
  it("keeps the reviewed snapshot across live updates and preserves retry after write failure", async () => {
    const onExport = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(true);
    const {host,root,props,button} = await mount("count", onExport);
    await act(async () => root.render(<BaseExportDialog {...props} rows={[{"file.path":"B.md",count:99}]} />));
    await act(async () => button(en.database.exportValues).click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(en.database.exportFailed);
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => button(en.database.exportValues).click());
    expect(onExport.mock.calls[1][0].text).toContain('"A.md","2"');
    expect(onExport.mock.calls[1][0].text).not.toContain("99");
    expect(props.onClose).toHaveBeenCalledOnce();
  });
  it("keeps the chooser open when the OS save dialog is cancelled", async () => {
    const {props,button} = await mount("count", vi.fn(async () => false));
    await act(async () => button(en.database.exportFormulas).click());
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
