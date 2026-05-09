import { useState, useCallback, useRef, useEffect } from "react";
import { loadFromStorage, saveToStorage } from "../utils/storage";

export function usePanelResize(
  storageKey: string,
  defaultWidth: number,
  minWidth: number,
  maxWidth: number,
  direction: "right" | "left" = "right",
) {
  const [width, setWidth] = useState(() =>
    loadFromStorage<number>(
      storageKey,
      (raw) => {
        const n = parseInt(raw, 10);
        return !isNaN(n) && n >= minWidth && n <= maxWidth ? n : undefined;
      },
      defaultWidth,
    ),
  );

  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = widthRef.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    let rafId = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const clientX = e.clientX;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const delta = clientX - startX.current;
        const next = Math.min(
          maxWidth,
          Math.max(
            minWidth,
            direction === "right"
              ? startWidth.current + delta
              : startWidth.current - delta,
          ),
        );
        setWidth(next);
      });
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      saveToStorage(storageKey, String(widthRef.current));
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [storageKey, minWidth, maxWidth, direction]);

  return { width, onMouseDown };
}
