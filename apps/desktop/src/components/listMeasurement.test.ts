// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { listIndentPlugin } from "@plainva/ui";
import { stableListPrefixWidth } from "../../../../packages/ui/src/components/listPrefixMeasurement";
import { onCompletedTap } from "../../../../packages/ui/src/components/completedTap";
import { forceFullParse } from "../test-parse";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("independent list prefix measurement", () => {
  it("settles with alternating half-pixel cursor coordinates and never measures its own result", async () => {
    const requests: NonNullable<Parameters<EditorView["requestMeasure"]>[0]>[] = [];
    vi.spyOn(EditorView.prototype, "requestMeasure").mockImplementation(request => { if (request) requests.push(request); });
    let sample = 0;
    const cursor = vi.spyOn(EditorView.prototype, "coordsAtPos").mockImplementation(pos => ({
      left: pos ? (++sample % 2 ? 11.5 : 12) : 0, right: 12, top: 0, bottom: 18,
    }));
    const rectangle = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.parentElement?.classList.contains("cm-list-prefix-measure")) return new DOMRect(0, 0, ++sample % 2 ? 11.5 : 12, 18);
      return rectangle.call(this);
    });
    const doc = "- Parent\n  - Child\n    - Third\n      continuation\n";
    let transactions = 0;
    const parent = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({ parent, state: forceFullParse(EditorState.create({ doc,
      extensions: [markdown(), listIndentPlugin(), EditorView.updateListener.of(() => transactions++)] })) });
    const settle = async () => {
      let passes = 0;
      while (requests.length && passes++ < 10) {
        const request = requests.shift()!;
        request.write?.(request.read(view), view);
        await Promise.resolve();
      }
      expect(requests).toHaveLength(0);
      expect(passes).toBeLessThanOrEqual(1);
    };
    try {
      await settle();
      expect(transactions).toBeLessThanOrEqual(1);
      expect(cursor).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(doc);
      view.dispatch({ changes: { from: doc.length, insert: "end" }, selection: { anchor: doc.length + 3 } });
      await settle();
      expect(view.state.doc.toString()).toBe(doc + "end");
      expect(view.state.selection.main.head).toBe(doc.length + 3);
    } finally { view.destroy(); }
    expect(document.querySelector(".cm-list-prefix-measure")).toBeNull();
  });

  it("retains a stable half-pixel result while accepting a real metric change", () => {
    let width: number | undefined;
    for (const raw of [11.5, 12, 11.5, 12, 11.5, 12]) width = stableListPrefixWidth(raw, width)!;
    expect(width).toBe(11.5);
    expect(stableListPrefixWidth(18.2, width)).toBe(18);
    expect(stableListPrefixWidth(-1)).toBeNull();
  });
});

describe("completed fold taps", () => {
  function gesture() {
    const element = document.body.appendChild(document.createElement("span"));
    const activate = vi.fn(), dispose = onCompletedTap(element, activate);
    const send = (type: string, properties: Record<string, unknown> = {}, target: HTMLElement = element) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20, ...properties });
      Object.defineProperties(event, { pointerId: { value: properties.pointerId ?? 1 }, isPrimary: { value: properties.isPrimary ?? true } });
      target.dispatchEvent(event);
    };
    return { element, activate, dispose, send };
  }
  it("activates only on primary release, preserving the text selection", () => {
    const { activate, dispose, send } = gesture();
    send("pointerdown"); expect(activate).not.toHaveBeenCalled();
    send("pointerup"); expect(activate).toHaveBeenCalledOnce(); dispose();
  });
  it.each(["horizontal", "vertical", "cancel", "second-pointer", "right-click", "context-menu", "destroy"])("ignores %s", kind => {
    const { activate, dispose, send } = gesture();
    send("pointerdown", kind === "right-click" ? { button: 2 } : {});
    if (kind === "horizontal") send("pointermove", { clientX: 60 });
    if (kind === "vertical") send("pointermove", { clientY: 60 });
    if (kind === "cancel") send("pointercancel");
    if (kind === "second-pointer") send("pointerdown", { pointerId: 2, isPrimary: false }, document.body);
    if (kind === "context-menu") send("contextmenu");
    if (kind === "destroy") dispose();
    send("pointerup"); expect(activate).not.toHaveBeenCalled(); dispose();
  });
});
