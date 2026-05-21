import { useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  width?: number;
  height?: number;
  className?: string;
  onClear?: () => void;
  onInkChange?: (hasInk: boolean) => void;
};

export type PortalSignaturePadHandle = {
  toDataUrl: () => string | null;
  clear: () => void;
  hasInk: () => boolean;
};

/** Canvas signature capture; use ref to call toDataUrl() for PNG data URL. */
export const PortalSignaturePad = forwardRef<PortalSignaturePadHandle, Props>(
  function PortalSignaturePad({ width = 320, height = 160, className, onClear, onInkChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const hasInkRef = useRef(false);

    const setHasInk = useCallback((next: boolean) => {
      if (hasInkRef.current === next) return;
      hasInkRef.current = next;
      onInkChange?.(next);
    }, [onInkChange]);

    const clearCanvas = useCallback(() => {
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (!ctx || !c) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      setHasInk(false);
      onClear?.();
    }, [onClear, setHasInk, width, height]);

    useImperativeHandle(ref, () => ({
      toDataUrl: () => canvasRef.current?.toDataURL("image/png") ?? null,
      clear: clearCanvas,
      hasInk: () => hasInkRef.current,
    }), [clearCanvas]);

    const pos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
      const c = canvasRef.current;
      if (!c) return { x: 0, y: 0 };
      const r = c.getBoundingClientRect();
      if ("touches" in e && e.touches[0]) {
        return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
      }
      const me = e as React.MouseEvent;
      return { x: me.clientX - r.left, y: me.clientY - r.top };
    }, []);

    useEffect(() => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }, [width, height]);

    const start = useCallback(
      (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        drawing.current = true;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const { x, y } = pos(e);
        ctx.beginPath();
        ctx.fillStyle = "#111";
        ctx.arc(x, y, 1.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y);
        setHasInk(true);
      },
      [pos, setHasInk],
    );

    const draw = useCallback(
      (e: React.MouseEvent | React.TouchEvent) => {
        if (!drawing.current) return;
        e.preventDefault();
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const { x, y } = pos(e);
        ctx.lineTo(x, y);
        ctx.stroke();
      },
      [pos],
    );

    const end = useCallback(() => {
      drawing.current = false;
    }, []);

    return (
      <div className={className}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="touch-none rounded border border-input bg-white max-w-full cursor-crosshair"
          onMouseDown={start}
          onMouseMove={draw}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={draw}
          onTouchEnd={end}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={clearCanvas}
        >
          Clear
        </Button>
      </div>
    );
  },
);

export function signatureDataUrlToRawBase64(dataUrl: string): string {
  const i = dataUrl.indexOf("base64,");
  if (i === -1) return dataUrl.replace(/\s/g, "");
  return dataUrl.slice(i + 7).replace(/\s/g, "");
}
