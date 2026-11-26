"use client";

import { useLayoutEffect, useRef } from "react";
import { startAmbientShader, type AmbientRenderer } from "@/components/shell/ambient-renderer";

// AI-038.7 ambient background: decorative only, takes no props and no data.
//
// The CSS mesh (AI-038.5) is the server-rendered fallback and stays the visible background before
// hydration, without WebGL, on any shader / context failure and under prefers-reduced-motion. When
// the WebGL renderer starts, `data-renderer="shader"` is set on the root (directly on the DOM: no
// React state, no re-render); CSS then cross-fades to the canvas and pauses the mesh animations.

// Active shader time survives page-to-page remounts within one document, so the shape continues
// instead of restarting on every navigation.
let sharedElapsedMs = 0;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function AmbientShaderBackground() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Layout effect: on client navigation the renderer is ready before paint, so the fallback never
  // flashes between pages.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const motion = window.matchMedia(REDUCED_MOTION);
    let renderer: AmbientRenderer | null = null;
    // After a context loss the canvas cannot render again: the CSS fallback stays until reload.
    let contextLost = false;

    const stop = () => {
      if (renderer) sharedElapsedMs = renderer.dispose();
      renderer = null;
      delete root.dataset.renderer;
    };
    const start = () => {
      if (renderer || contextLost || motion.matches) return;
      const result = startAmbientShader({
        canvas,
        startElapsedMs: sharedElapsedMs,
        scheduler: {
          request: (callback) => window.requestAnimationFrame(callback),
          cancel: (handle) => window.cancelAnimationFrame(handle),
        },
        visibility: {
          isHidden: () => document.hidden,
          subscribe: (listener) => {
            document.addEventListener("visibilitychange", listener);
            return () => document.removeEventListener("visibilitychange", listener);
          },
        },
        size: {
          subscribe: (listener) => {
            const report = () => listener(canvas.clientWidth, canvas.clientHeight);
            report();
            if (typeof ResizeObserver === "function") {
              const observer = new ResizeObserver(report);
              observer.observe(canvas);
              return () => observer.disconnect();
            }
            window.addEventListener("resize", report);
            return () => window.removeEventListener("resize", report);
          },
        },
        onContextLost: () => {
          contextLost = true;
          stop();
        },
      });
      if (!result.ok) return;
      renderer = result.renderer;
      root.dataset.renderer = "shader";
    };
    const onMotionPreference = () => (motion.matches ? stop() : start());

    start();
    motion.addEventListener("change", onMotionPreference);
    return () => {
      motion.removeEventListener("change", onMotionPreference);
      stop();
    };
  }, []);

  return (
    <div aria-hidden className="pac-ambient" ref={rootRef}>
      <div className="pac-ambient-mesh">
        <span className="pac-ambient-field pac-ambient-field-a" />
        <span className="pac-ambient-field pac-ambient-field-b" />
        <span className="pac-ambient-field pac-ambient-field-c" />
        <span className="pac-ambient-field pac-ambient-field-d" />
      </div>
      <canvas className="pac-ambient-canvas" ref={canvasRef} />
    </div>
  );
}
