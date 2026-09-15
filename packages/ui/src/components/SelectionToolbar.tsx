import React, { useLayoutEffect, useRef, type HTMLAttributes } from "react";
import { Bold, Italic, Strikethrough, Code, Highlighter, Link } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EditorView } from "@codemirror/view";
import { ICON } from "../lib/iconSizes";
import { toggleInlineMark } from "./editorTouchCommands";

export type FormatAction = "bold" | "italic" | "strike" | "code" | "highlight" | "link";

interface Props {
  x: number;
  y: number;
  /** Render above the selection (true) or below it (near the top edge). */
  above: boolean;
  onAction: (action: FormatAction) => void;
}

/** Both shells measure the real toolbar instead of assuming that its labels
 * fit to the right of a selected word. The visual viewport also accounts for
 * the phone's keyboard, zoom and changing orientation. */
export function SelectionToolbarSurface({ x, y, above, className = "", children, ...props }: {
  x: number; y: number; above: boolean;
} & Omit<HTMLAttributes<HTMLDivElement>, "style">) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const viewport = window.visualViewport;
    const measure = () => {
      const margin = 8;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const styles = getComputedStyle(el);
      const inset = (edge: string) => Math.max(margin, parseFloat(styles.getPropertyValue(`--selection-safe-${edge}`)) || 0);
      const minX = leftEdge + inset("left"), maxX = leftEdge + width - inset("right");
      const minY = topEdge + inset("top"), maxY = topEdge + height - inset("bottom");
      el.style.maxWidth = `${Math.max(0, maxX - minX)}px`;
      el.style.maxHeight = `${Math.max(0, maxY - minY)}px`;
      const left = Math.max(minX, Math.min(x, maxX - el.offsetWidth));
      const top = Math.max(minY, Math.min(above ? y - el.offsetHeight : y, maxY - el.offsetHeight));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
    };
  }, [x, y, above]);
  return <div {...props} ref={ref} className={`pv-popover--fixed pv-seltoolbar ${className}`}>{children}</div>;
}

/**
 * Floating formatting toolbar over a non-empty selection (#5), shared since
 * S18 so the phone gets the same six actions rather than a second set.
 *
 * `onMouseDown`/`onPointerDown` preventDefault is essential: it keeps the
 * editor's selection and focus while a button is pressed, so the formatting
 * applies to the range the user actually marked. On touch that matters more,
 * not less — a tap that drops the selection would format nothing.
 */
export const SelectionToolbar: React.FC<Props> = ({ x, y, above, onAction }) => {
  const { t } = useTranslation();
  const items: { a: FormatAction; icon: React.ReactNode; label: string }[] = [
    { a: "bold", icon: <Bold size={ICON.ui} />, label: t("editor.fmtBold", { defaultValue: "Fett" }) },
    { a: "italic", icon: <Italic size={ICON.ui} />, label: t("editor.fmtItalic", { defaultValue: "Kursiv" }) },
    { a: "strike", icon: <Strikethrough size={ICON.ui} />, label: t("editor.fmtStrike", { defaultValue: "Durchgestrichen" }) },
    { a: "code", icon: <Code size={ICON.ui} />, label: t("editor.fmtCode", { defaultValue: "Inline-Code" }) },
    { a: "highlight", icon: <Highlighter size={ICON.ui} />, label: t("editor.fmtHighlight", { defaultValue: "Markierung" }) },
    { a: "link", icon: <Link size={ICON.ui} />, label: t("editor.fmtLink", { defaultValue: "Link" }) },
  ];

  return (
    <SelectionToolbarSurface
      role="toolbar"
      aria-label={t("editor.fmtToolbar", { defaultValue: "Formatierung" })}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.preventDefault()}
      x={x}
      y={y}
      above={above}
    >
      {items.map((it) => (
        <button
          key={it.a}
          type="button"
          data-tip={it.label}
          aria-label={it.label}
          onClick={() => onAction(it.a)}
          className="pv-iconbtn"
        >
          {it.icon}
        </button>
      ))}
    </SelectionToolbarSurface>
  );
};

/**
 * Applies a toolbar action to the current selection (shared since S18).
 *
 * The six actions are the same on both shells, so the logic is too — including
 * the one case that is not a simple marker: a link cannot span lines, and the
 * caller is told rather than left with a broken one.
 */
export function applySelectionFormat(
  view: EditorView,
  action: FormatAction,
  onMultilineLink: () => void,
): void {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const text = view.state.sliceDoc(sel.from, sel.to);
  if (action === "link") {
    if (/\r?\n/.test(text)) {
      onMultilineLink();
      view.focus();
      return;
    }
    const insert = `[${text}](url)`;
    const urlAt = sel.from + 1 + text.length + 2; // the "url" placeholder
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: urlAt, head: urlAt + 3 },
      userEvent: "input",
    });
    view.focus();
    return;
  }
  const marker =
    action === "bold" ? "**"
    : action === "italic" ? "*"
    : action === "strike" ? "~~"
    : action === "code" ? "`"
    : "==";
  toggleInlineMark(view, marker);
}
