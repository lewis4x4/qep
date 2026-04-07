/**
 * Wave 6.11 Flare — annotator overlay.
 *
 * Canvas overlay on the captured screenshot for arrow / circle / free-draw
 * annotations. Spec §1 v1 ships these 3 tools max.
 *
 * The annotator is opened from a button in FlareDrawer; on save it returns
 * the modified PNG dataURL back to the drawer to replace the screenshot
 * before submission.
 */
import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Circle, Pencil, Undo2, Check } from "lucide-react";
import type { FlareAnnotation } from "./types";

type Tool = "arrow" | "circle" | "scribble";

interface FlareAnnotatorProps {
  open: boolean;
  screenshotDataUrl: string;
  onSave: (annotatedDataUrl: string, annotations: FlareAnnotation[]) => void;
  onCancel: () => void;
}

interface DrawingState {
  tool: Tool;
  points: number[];
}

export function FlareAnnotator({
  open, screenshotDataUrl, onSave, onCancel,
}: FlareAnnotatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("arrow");
  const [strokes, setStrokes] = useState<DrawingState[]>([]);
  const [activeStroke, setActiveStroke] = useState<DrawingState | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);

  // Load image + size canvas to it
  useEffect(() => {
    if (!open || !screenshotDataUrl) return;
    const img = new Image();
    img.onload = () => {
      setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
      requestAnimationFrame(() => redrawCanvas([]));
    };
    img.src = screenshotDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, screenshotDataUrl]);

  // Redraw on stroke changes
  useEffect(() => {
    if (imgDims) redrawCanvas(strokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, imgDims]);

  function redrawCanvas(strokesToDraw: DrawingState[]): void {
    const canvas = canvasRef.current;
    if (!canvas || !imgDims) return;
    canvas.width = imgDims.w;
    canvas.height = imgDims.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      ctx.strokeStyle = "#ef4444";
      ctx.fillStyle = "#ef4444";
      ctx.lineWidth = Math.max(3, imgDims.w / 400);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (const s of strokesToDraw) {
        drawStroke(ctx, s);
      }
      if (activeStroke) {
        drawStroke(ctx, activeStroke);
      }
    };
    img.src = screenshotDataUrl;
  }

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: DrawingState): void {
    const p = stroke.points;
    if (p.length < 4) return;

    if (stroke.tool === "scribble") {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) {
        ctx.lineTo(p[i], p[i + 1]);
      }
      ctx.stroke();
    } else if (stroke.tool === "circle") {
      const x1 = p[0], y1 = p[1], x2 = p[p.length - 2], y2 = p[p.length - 1];
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (stroke.tool === "arrow") {
      const x1 = p[0], y1 = p[1], x2 = p[p.length - 2], y2 = p[p.length - 1];
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Arrowhead
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.max(15, imgDims!.w / 60);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
  }

  function getPointerPos(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    const [x, y] = getPointerPos(e);
    setActiveStroke({ tool, points: [x, y, x, y] });
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!activeStroke) return;
    const [x, y] = getPointerPos(e);
    if (activeStroke.tool === "scribble") {
      setActiveStroke({ ...activeStroke, points: [...activeStroke.points, x, y] });
    } else {
      // arrow / circle: only the start + current end
      setActiveStroke({
        ...activeStroke,
        points: [activeStroke.points[0], activeStroke.points[1], x, y],
      });
    }
    requestAnimationFrame(() => redrawCanvas(strokes));
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!activeStroke) return;
    setStrokes((prev) => [...prev, activeStroke]);
    setActiveStroke(null);
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  function handleUndo(): void {
    setStrokes((prev) => prev.slice(0, -1));
  }

  function handleSave(): void {
    const canvas = canvasRef.current;
    if (!canvas) {
      onSave(screenshotDataUrl, []);
      return;
    }
    const annotatedDataUrl = canvas.toDataURL("image/png");
    const annotations: FlareAnnotation[] = strokes.map((s) => ({
      type: s.tool,
      points: s.points,
    }));
    onSave(annotatedDataUrl, annotations);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Annotate screenshot</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
          <Button
            size="sm"
            variant={tool === "arrow" ? "default" : "outline"}
            onClick={() => setTool("arrow")}
          >
            <ArrowUpRight className="mr-1 h-3 w-3" /> Arrow
          </Button>
          <Button
            size="sm"
            variant={tool === "circle" ? "default" : "outline"}
            onClick={() => setTool("circle")}
          >
            <Circle className="mr-1 h-3 w-3" /> Circle
          </Button>
          <Button
            size="sm"
            variant={tool === "scribble" ? "default" : "outline"}
            onClick={() => setTool("scribble")}
          >
            <Pencil className="mr-1 h-3 w-3" /> Scribble
          </Button>
          <span className="ml-auto" />
          <Button size="sm" variant="ghost" onClick={handleUndo} disabled={strokes.length === 0}>
            <Undo2 className="mr-1 h-3 w-3" /> Undo
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="block w-full cursor-crosshair touch-none"
            style={{ aspectRatio: imgDims ? `${imgDims.w} / ${imgDims.h}` : "16 / 9" }}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSave}>
            <Check className="mr-1 h-3 w-3" /> Save annotations
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
