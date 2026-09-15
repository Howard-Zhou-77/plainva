import { useLayoutEffect, useRef } from "react";

/** Reserve the measured overlap, including wrapped actions and larger text. */
export function useFloatingSelectionSpace(visible: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current, page = bar?.parentElement;
    if (!visible || !bar || !page) return;
    const measure = () => page.style.setProperty("--m-selection-space", `${Math.max(0, page.getBoundingClientRect().bottom - bar.getBoundingClientRect().top)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar); observer.observe(page);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); page.style.removeProperty("--m-selection-space"); };
  }, [visible]);
  return ref;
}
