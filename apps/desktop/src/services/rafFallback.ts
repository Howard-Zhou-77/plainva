/**
 * requestAnimationFrame fallback for WebKitGTK environments.
 *
 * Evidence: on Linux, Tauri v2 AppImage bundles its own libwayland-client.
 * On hosts with Mesa 25+ (Fedora 44, Ubuntu 26.04), the bundled copy is
 * older than what Mesa's EGL expects, and the graphics stack goes silent
 * without crashing — windows stay painted but stop advancing frames.
 * See plainva's src/linux_appimage.rs (issue #85, upstream
 * tauri-apps/tauri#15665).
 *
 * CodeMirror 6 routes every view update through a single path:
 * `requestAnimationFrame → measure() → viewState.measure() → DOM sync`.
 * (see @codemirror/view requestMeasure → measureScheduled at line ~8327,
 * and measure() → viewState.measure() at line ~8168). The keydown handler
 * calls forceFlush() synchronously (line ~4631), which updates EditorState
 * without rAF, so data is saved — but the DOM stays stale until measure()
 * runs. When rAF stalls, the editor state is correct while the view never
 * repaints.
 *
 * This module probes rAF at startup (150 ms deadline) and only activates
 * a setTimeout fallback when the probe confirms rAF is not firing. On
 * platforms where rAF works — which is the vast majority — rAF is left
 * untouched and there is zero runtime overhead after the probe completes.
 *
 * Must be imported BEFORE any CodeMirror EditorView is created.
 */

let installed = false

function installRAFFallback(): void {
  if (installed) return
  installed = true

  const nativeRAF = window.requestAnimationFrame.bind(window)
  const nativeCAF = window.cancelAnimationFrame.bind(window)

  // Assume broken until the probe proves otherwise.  Editors created
  // during the probe window get the fallback path, which is safe.
  let rafBroken = true
  const entries = new Map<number, { timer: ReturnType<typeof setTimeout>; fired: boolean }>()

  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    let fired = false
    const rafId = nativeRAF((time: DOMHighResTimeStamp) => {
      if (fired) return
      fired = true
      const entry = entries.get(rafId)
      if (entry) {
        clearTimeout(entry.timer)
        entries.delete(rafId)
      }
      callback(time)
    })
    if (rafBroken) {
      const timer = setTimeout(() => {
        const entry = entries.get(rafId)
        if (entry && !entry.fired) {
          entry.fired = true
          fired = true
          entries.delete(rafId)
          callback(performance.now())
        }
      }, 100)
      entries.set(rafId, { timer, fired: false })
    }
    return rafId
  }

  window.cancelAnimationFrame = (handle: number): void => {
    const entry = entries.get(handle)
    if (entry) {
      clearTimeout(entry.timer)
      entries.delete(handle)
    }
    nativeCAF(handle)
  }

  // Probe: does native rAF actually fire within 150 ms?
  let testFired = false
  const testHandle = nativeRAF(() => { testFired = true })
  setTimeout(() => {
    if (testFired) {
      rafBroken = false
      // Cancel any fallback entries still pending from the probe window.
      for (const [, entry] of entries) {
        clearTimeout(entry.timer)
      }
      entries.clear()
      // Replace with direct pass-through — zero overhead from here on.
      window.requestAnimationFrame = nativeRAF
      window.cancelAnimationFrame = nativeCAF
    }
    // If testFired is false the wrapper stays active permanently.
    nativeCAF(testHandle)
  }, 150)
}

export { installRAFFallback }
