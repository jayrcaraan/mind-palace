import { useCallback, useRef } from "react";

export function ResizeHandle({
  onResize, onResizeStart, onResizeEnd, min = 200, max = 460,
}: {
  onResize: (w: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  min?: number;
  max?: number;
}) {
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    onResizeStart?.();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.min(max, Math.max(min, ev.clientX - 248)); // 248 = app sidebar width
      onResize(w);
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEnd?.();
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [onResize, onResizeStart, onResizeEnd, min, max]);

  return (
    <div
      onMouseDown={onMouseDown}
      style={{ width: 5, flexShrink: 0, cursor: "col-resize", position: "relative", zIndex: 5 }}
      className="mp-resize-handle"
    >
      <div style={{
        position: "absolute", left: 2, top: 0, bottom: 0, width: 1,
        background: "var(--border)", transition: "background var(--motion-fast) var(--ease)",
      }} className="mp-resize-line" />
    </div>
  );
}
