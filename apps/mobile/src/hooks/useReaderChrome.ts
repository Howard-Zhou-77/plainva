import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { getChromeScroll, readerScrollSource, subscribeChromeScroll } from "../services/chromeScroll";
import { getMobileSettings } from "../services/mobileSettings";
import { useSoftKeyboard } from "./useSoftKeyboard";

/** Retreat only the current reader's controls. The navigator can scroll on its
 * own on a tablet without taking this note's Back button away. */
export function useReaderChrome(vaultId: string, path: string, overlay: boolean, blocked: boolean) {
  const scroll = useSyncExternalStore(subscribeChromeScroll, getChromeScroll);
  const [enabled, setEnabled] = useState(getMobileSettings().readerAutoHide);
  const [keyboard, setKeyboard] = useState(false);
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [chromeNode, setChromeNode] = useState<HTMLDivElement | null>(null);
  useSoftKeyboard(setKeyboard);
  useEffect(() => {
    const read = () => setEnabled(getMobileSettings().readerAutoHide);
    window.addEventListener("m-settings-changed", read);
    return () => window.removeEventListener("m-settings-changed", read);
  }, []);
  useLayoutEffect(() => {
    const node = chromeNode;
    if (!node) return;
    const read = () => setHeight(node.offsetHeight);
    read(); const observer = new ResizeObserver(read); observer.observe(node);
    return () => observer.disconnect();
  }, [chromeNode]);
  const active = scroll.source === readerScrollSource(vaultId, path);
  return {
    chromeRef: setChromeNode,
    away: overlay && enabled && active && scroll.away && !blocked && !keyboard && !focused,
    scroll: active ? scroll : { scrolled: false, away: false },
    pageStyle: height ? { "--m-reader-chrome-height": `${height}px` } as CSSProperties : undefined,
    onFocusCapture: () => setFocused(true),
    onBlurCapture: () => { queueMicrotask(() => setFocused(!!chromeNode?.contains(document.activeElement))); },
  };
}
