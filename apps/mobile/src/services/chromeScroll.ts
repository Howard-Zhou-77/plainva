/**
 * How far the surface below the chrome has scrolled, and in which direction
 * (S11). Two pieces of chrome react to it and they sit in different subtrees:
 * the app bar raises itself, the navigation bar draws itself in.
 *
 * The app bar is the one that finds the scrolling element (it is inside it), so
 * it publishes here and the bar subscribes. One listener, two readers — better
 * than a second listener that would have to guess the same element.
 */

export interface ChromeScroll {
  /** Content has moved under the chrome — the bar raises itself. */
  scrolled: boolean;
  /** Reading downwards: the navigation bar retreats until the user comes back. */
  away: boolean;
  source?: string;
}

let state: ChromeScroll = { scrolled: false, away: false };
const listeners = new Set<() => void>();

export function getChromeScroll(): ChromeScroll {
  return state;
}

export function subscribeChromeScroll(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setChromeScroll(next: ChromeScroll): void {
  if (next.scrolled === state.scrolled && next.away === state.away && next.source === state.source) return;
  state = next;
  for (const fn of listeners) fn();
}

/** A new surface starts at the top — otherwise it inherits the last one's state. */
export function resetChromeScroll(): void {
  setChromeScroll({ scrolled: false, away: false });
}


/** The hide threshold stays above the former 21 px layout correction. */
export const CHROME_SCROLL_DEAD_ZONE = 24;
export const readerScrollSource = (vaultId: string, path: string) => `${vaultId}:${path}`;
export function chromeScrollPublisher(source?: string) {
  let lastTop = 0, anchor = 0, away = false;
  return (rawTop: number, restore = false) => {
    const top = Math.max(0, rawTop), delta = top - lastTop;
    if (restore || top <= 2 || delta < -0.5) { away = false; anchor = top; }
    else if (top - anchor > CHROME_SCROLL_DEAD_ZONE) { away = top > 48; anchor = top; }
    lastTop = top;
    setChromeScroll({ scrolled: top > 2, away, source });
  };
}
