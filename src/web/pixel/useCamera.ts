import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import {
  cameraViewport, canPan, DRAG_THRESHOLD, FIT, isZoomed, panBy, scaleLimits, toPlan, WHEEL_STEP, zoomAt, type Camera, type Screen,
} from './camera';
import type { PixelPlan } from './types';

/** superficie del canvas in pixel fisici, come il backing store che disegna PixelOffice */
export function screenOf(el: HTMLCanvasElement): Screen {
  const dpr = window.devicePixelRatio || 1;
  return { w: Math.max(1, Math.round(el.clientWidth * dpr)), h: Math.max(1, Math.round(el.clientHeight * dpr)), dpr };
}

/** pixel fisici del canvas per pixel CSS (il backing store può differire di un arrotondamento) */
const physical = (el: HTMLCanvasElement): number => el.width / (el.getBoundingClientRect().width || 1);

interface Drag {
  pointer: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  moved: boolean;
}

/**
 * Zoom e trascinamento della vista 2D (#87): pulsanti, rotella con ctrl/⌘ (e pinch del trackpad, che il browser
 * manda come rotella con ctrlKey), scorrimento a due dita e trascinamento quando è ingrandita. Un clic senza
 * trascinamento resta una selezione: `pick` trova il personaggio nel punto della pianta.
 */
export function useCamera(canvas: RefObject<HTMLCanvasElement | null>, plan: Pick<PixelPlan, 'width' | 'depth'>, {
  pick, onSelect,
}: {
  pick: (x: number, y: number) => string | null;
  onSelect: (id: string | null) => void;
}) {
  const [camera, setState] = useState<Camera>(FIT);
  // copia sincrona: gli eventi fitti (rotella, trascinamento) partono sempre dall'ultima camera
  const cam = useRef<Camera>(FIT);
  const setCamera = (f: (c: Camera) => Camera): Camera => {
    const next = f(cam.current);
    if (next !== cam.current) {
      cam.current = next;
      setState(next);
    }
    return next;
  };
  const [screen, setScreen] = useState<Screen | null>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  // dimensioni del canvas per i limiti dei pulsanti
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const update = () => setScreen(screenOf(el));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [canvas]);

  // rotella: listener nativo non passivo, per fermare lo zoom della pagina con ctrl/⌘
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (ev: WheelEvent) => {
      const k = physical(el);
      const s = screenOf(el);
      const r = el.getBoundingClientRect();
      // deltaMode 1 = righe (Firefox con la rotella del mouse)
      const unit = ev.deltaMode === 1 ? 16 : 1;
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        acc -= ev.deltaY * unit;
        const steps = Math.trunc(acc / WHEEL_STEP);
        if (steps === 0) return;
        acc -= steps * WHEEL_STEP;
        const ax = (ev.clientX - r.left) * k;
        const ay = (ev.clientY - r.top) * k;
        setCamera((c) => zoomAt(c, s, plan, steps, ax, ay));
      } else {
        // scorrimento (due dita sul trackpad): sposta la pianta se c'è qualcosa da vedere
        if (!canPan(cam.current, s, plan)) return;
        ev.preventDefault();
        setCamera((c) => panBy(c, s, plan, -ev.deltaX * unit * k, -ev.deltaY * unit * k));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [canvas, plan]);

  /** punto della pianta sotto il puntatore */
  const planPoint = (ev: PointerEvent<HTMLCanvasElement>) => {
    const el = ev.currentTarget;
    const r = el.getBoundingClientRect();
    const k = physical(el);
    return toPlan(cameraViewport(cam.current, screenOf(el), plan), (ev.clientX - r.left) * k, (ev.clientY - r.top) * k);
  };

  const handlers = {
    onPointerDown: (ev: PointerEvent<HTMLCanvasElement>) => {
      if (ev.button !== 0) return;
      drag.current = { pointer: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, moved: false };
    },
    onPointerMove: (ev: PointerEvent<HTMLCanvasElement>) => {
      const el = ev.currentTarget;
      const d = drag.current;
      const s = screenOf(el);
      if (d && d.pointer === ev.pointerId) {
        if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > DRAG_THRESHOLD && canPan(cam.current, s, plan)) {
          d.moved = true;
          el.setPointerCapture?.(ev.pointerId);
          setDragging(true);
        }
        if (d.moved) {
          const k = physical(el);
          const dx = (ev.clientX - d.x) * k;
          const dy = (ev.clientY - d.y) * k;
          setCamera((c) => panBy(c, s, plan, dx, dy));
        }
        d.x = ev.clientX;
        d.y = ev.clientY;
        if (d.moved) return;
      }
      const p = planPoint(ev);
      el.style.cursor = pick(p.x, p.y) ? 'pointer' : canPan(cam.current, s, plan) ? 'grab' : '';
    },
    onPointerUp: (ev: PointerEvent<HTMLCanvasElement>) => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.pointer !== ev.pointerId) return;
      if (d.moved) {
        setDragging(false);
        return;
      }
      const p = planPoint(ev);
      onSelect(pick(p.x, p.y));
    },
    onPointerCancel: () => {
      drag.current = null;
      setDragging(false);
    },
  };

  const limits = screen ? scaleLimits(screen, plan) : null;
  const scale = screen ? cameraViewport(camera, screen, plan).scale : null;
  const zoomBy = (steps: number) => {
    const el = canvas.current;
    if (el) setCamera((c) => zoomAt(c, screenOf(el), plan, steps));
  };
  return {
    camera,
    /** la camera corrente per il loop di disegno, senza aspettare il rendering di React */
    cameraRef: cam,
    handlers,
    dragging,
    controls: {
      canZoomIn: limits !== null && scale !== null && scale < limits.max,
      canZoomOut: screen !== null && isZoomed(camera, screen, plan),
      zoomIn: () => zoomBy(1),
      zoomOut: () => zoomBy(-1),
      fit: () => setCamera(() => FIT),
    },
  };
}
