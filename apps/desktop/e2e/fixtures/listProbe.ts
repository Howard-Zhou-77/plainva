import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { listIndentPlugin, listMarkerPrefixLength } from "../../../../packages/ui/src/components/listIndent";
import { markdownFolding, toggleFoldAtLine } from "../../../../packages/ui/src/components/foldingExtension";
import { markdownDecorationPlugin } from "../../../../packages/ui/src/components/LivePreviewPlugin";
import { editorTheme, markdownTheme } from "../../../../packages/ui/src/components/MarkdownTheme";
import "../../../../packages/ui/src/styles/base-colors.css";
import "../../../../packages/ui/src/styles/tokens.css";
import "../../../../packages/ui/src/styles/ui.css";
import "../../../../packages/ui/src/themes/index.css";
import "../../src/App.css";
import "../../../mobile/src/mobile.css";

export interface ListProbeOptions { live: boolean; indent: string; size: number; font: string; shell: "mobile" | "desktop" }
function createProbe() {
  let view: EditorView, updates = 0;
  return {
    mount(options: ListProbeOptions) {
      view?.destroy();
      const host = document.getElementById("host")!;
      host.replaceChildren(); host.className = options.shell === "mobile" ? "m-editor" : "";
      document.documentElement.dataset.theme = "light";
      document.documentElement.dataset.themeName = "petrol";
      document.documentElement.style.setProperty("--content-font-size", `${options.size}px`);
      if (options.font === "default") document.documentElement.style.removeProperty("--font-content");
      else document.documentElement.style.setProperty("--font-content", options.font);
      const doc = [0, 1, 2].map(depth => `${options.indent.repeat(depth)}- Level ${depth + 1} with enough text to wrap onto another display line while preserving its actual text alignment`).join("\n")
        + `\n${options.indent.repeat(3)}continuation of the third level\n- Sibling\n\n10. Ordered item with enough text to wrap onto another display line and test the complete number width\n\n- [ ] A task with enough text to wrap onto another display line and test the actual checkbox width\n`;
      updates = 0;
      view = new EditorView({ parent: host, state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [
        markdown(), editorTheme, markdownTheme(), EditorView.lineWrapping, listIndentPlugin({ hideLeadingWhitespace: options.live }),
        markdownDecorationPlugin(options.live), markdownFolding(), EditorView.updateListener.of(() => updates++),
      ] }) });
      return doc;
    },
    snapshot() {
      return { updates, text: view.state.doc.toString(), cursor: view.state.selection.main.head,
        size: getComputedStyle(view.contentDOM).fontSize, styles: Array.from(view.contentDOM.querySelectorAll(".cm-line"), element => element.getAttribute("style")) };
    },
    alignments() {
      const results: Array<{ line: number; first: number; wrapped: number }> = [];
      for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
        const line = view.state.doc.line(lineNo), prefix = listMarkerPrefixLength(line.text);
        if (prefix === null) continue;
        const first = view.coordsAtPos(line.from + prefix, 1);
        if (!first) continue;
        for (let pos = line.from + prefix + 1; pos < line.to; pos++) {
          const next = view.coordsAtPos(pos, 1);
          if (next && next.top > first.top + 8) { results.push({ line: lineNo, first: first.left, wrapped: next.left }); break; }
        }
      }
      return results;
    },
    fold() { return toggleFoldAtLine(view, 0); },
    geometry() { view.scrollDOM.scrollLeft = 24; view.requestMeasure(); },
    font(size: number) { document.documentElement.style.setProperty("--content-font-size", `${size}px`); view.requestMeasure(); },
    edit() {
      const end = view.state.doc.length;
      view.dispatch({ changes: { from: end, insert: "Further input" }, selection: { anchor: end + 13 } });
    },
  };
}
export type ListProbeWindow = Window & { listProbe: ReturnType<typeof createProbe> };
(window as ListProbeWindow).listProbe = createProbe();
