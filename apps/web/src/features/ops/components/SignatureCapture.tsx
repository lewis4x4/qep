import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface SignatureCaptureProps {
  onCapture: (dataUrl: string) => void;
  label?: string;
}

export function SignatureCapture({ onCapture, label = "Delivery Signature" }: SignatureCaptureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);

  function getCtx() {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  function getPos(e: React.TouchEvent | React.MouseEvent): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }

  function startDraw(e: React.TouchEvent | React.MouseEvent) {
    const ctx = getCtx();
    if (!ctx) return;
    setIsDrawing(true);
    setHasSigned(true);
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }

  function draw(e: React.TouchEvent | React.MouseEvent) {
    if (!isDrawing) return;
    const ctx = getCtx();
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#e97316"; // QEP Orange
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function endDraw() {
    setIsDrawing(false);
  }

  function clear() {
    const ctx = getCtx();
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasSigned(false);
  }

  function save() {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onCapture(dataUrl);
  }

  return (
    <Card className="p-4">
      <p className="text-sm font-semibold text-foreground mb-3">{label}</p>
      <canvas
        ref={canvasRef}
        width={400}
        height={150}
        className="w-full rounded-lg border border-border bg-card touch-none"
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" onClick={clear}>Clear</Button>
        <Button size="sm" onClick={save} disabled={!hasSigned}>Save Signature</Button>
      </div>
    </Card>
  );
}
