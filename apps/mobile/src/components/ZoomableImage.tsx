import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { ICON, IconButton } from "@plainva/ui";
import { boundImageTransform, IMAGE_ZOOM_MAX, imageFit, zoomImageAt, type ImageBounds, type ImageTransform } from "../lib/imageZoom";

const DOUBLE_TAP_MS = 280;
type Point = { x: number; y: number };
/** Only the dedicated viewer owns these gestures. Embedded images retain the
 * platform's native long-press actions and the editor's comment-region picker. */
export function ZoomableImage({ url, name, onError }: { url: string; name: string; onError: () => void }) {
  const { t } = useTranslation();
  const stage = useRef<HTMLDivElement>(null), img = useRef<HTMLImageElement>(null);
  const current = useRef<ImageTransform>(imageFit);
  const [transform, setTransform] = useState<ImageTransform>(imageFit);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: ImageTransform; point: Point; distance: number; moved: boolean; pinched: boolean } | null>(null);
  const lastPointerType = useRef("");
  const lastTap = useRef<{ time: number; point: Point } | null>(null);
  const bounds = (): ImageBounds => ({ width: stage.current?.clientWidth ?? 1, height: stage.current?.clientHeight ?? 1, imageWidth: img.current?.naturalWidth ?? 1, imageHeight: img.current?.naturalHeight ?? 1 });
  const commit = (value: ImageTransform) => { const next = boundImageTransform(value, bounds()); current.current = next; setTransform(next); };
  const point = (e: { clientX: number; clientY: number }): Point => { const rect = stage.current!.getBoundingClientRect(); return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 }; };
  const center = () => { const pts = [...pointers.current.values()]; return pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0]; };
  const distance = () => { const pts = [...pointers.current.values()]; return pts.length > 1 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : 0; };
  const begin = (pinched = false) => { gesture.current = { start: current.current, point: center(), distance: distance(), moved: false, pinched: pinched || pointers.current.size > 1 }; };
  const zoom = (scale: number, at: Point = { x: 0, y: 0 }) => commit(zoomImageAt(current.current, scale, at, at, bounds()));
  useEffect(() => {
    const node = stage.current; if (!node) return;
    const observer = new ResizeObserver(() => { const next = boundImageTransform(current.current, bounds()); current.current = next; setTransform(next); });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  const finish = (e: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const saved = gesture.current;
    pointers.current.delete(e.pointerId);
    if (!cancelled && saved && !saved.moved && !saved.pinched && e.pointerType === "touch") {
      const at = point(e), previous = lastTap.current, time = Date.now();
      if (previous && time - previous.time <= DOUBLE_TAP_MS && Math.hypot(at.x - previous.point.x, at.y - previous.point.y) < 24) {
        if (current.current.scale > 1) commit(imageFit); else zoom(2.5, at);
        lastTap.current = null;
      } else lastTap.current = { time, point: at };
    } else lastTap.current = null;
    if (pointers.current.size) begin(true); else gesture.current = null;
  };
  return <>
    <div ref={stage} className="m-image-stage" tabIndex={0} role="group" aria-label={name} data-testid="image-zoom-stage" data-zoom={transform.scale}
      onKeyDown={e => { if (["+", "=", "-", "0"].includes(e.key)) { e.preventDefault(); if (e.key === "0") commit(imageFit); else zoom(current.current.scale * (e.key === "-" ? 1 / 1.5 : 1.5)); } }}
      onDoubleClick={e => { if (lastPointerType.current === "touch") return; if (current.current.scale > 1) commit(imageFit); else zoom(2.5, point(e)); }}
      onPointerDown={e => { if (e.button !== 0) return; lastPointerType.current = e.pointerType; pointers.current.set(e.pointerId, point(e)); e.currentTarget.setPointerCapture(e.pointerId); begin(); }}
      onPointerMove={e => {
        if (!pointers.current.has(e.pointerId) || !gesture.current) return;
        pointers.current.set(e.pointerId, point(e)); const g = gesture.current, at = center();
        if (Math.hypot(at.x - g.point.x, at.y - g.point.y) > 6 || pointers.current.size > 1) g.moved = true;
        if (!g.moved) return;
        if (pointers.current.size > 1 && g.distance > 0) commit(zoomImageAt(g.start, g.start.scale * distance() / g.distance, g.point, at, bounds()));
        else commit({ ...g.start, x: g.start.x + at.x - g.point.x, y: g.start.y + at.y - g.point.y });
      }}
      onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => { if (pointers.current.has(e.pointerId)) finish(e, true); }}>
      <img ref={img} src={url} alt={name} draggable={false} onLoad={() => commit(imageFit)} onError={onError}
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} />
    </div>
    <div className="m-image-tools" role="group" aria-label={t("contextMenu.openImage")}>
      <IconButton label={t("imageViewer.zoomOut")} disabled={transform.scale <= 1} onClick={() => zoom(current.current.scale / 1.5)}><Minus size={ICON.ui} /></IconButton>
      <output aria-live="polite">{Math.round(transform.scale * 100)}%</output>
      <IconButton label={t("imageViewer.zoomIn")} disabled={transform.scale >= IMAGE_ZOOM_MAX} onClick={() => zoom(current.current.scale * 1.5)}><Plus size={ICON.ui} /></IconButton>
      <IconButton label={t("imageViewer.zoomReset")} onClick={() => commit(imageFit)}><RotateCcw size={ICON.ui} /></IconButton>
    </div>
  </>;
}
