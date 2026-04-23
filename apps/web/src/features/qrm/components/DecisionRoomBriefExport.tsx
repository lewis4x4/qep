/**
 * DecisionRoomBriefExport — one-click markdown export for team handoffs.
 * Grabs the current page state (board + coach read + moves + futures)
 * and produces a shareable brief. Copy-to-clipboard and download-as-file
 * both work; no server round-trip.
 */
import { useState } from "react";
import { Copy, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { DeckSurface } from "./command-deck";
import { buildRoomBriefMarkdown } from "../lib/decision-room-brief";
import type { DecisionRoomBoard } from "../lib/decision-room-simulator";
import type { FutureTick } from "../lib/decision-room-future";
import type { RecommendedMove } from "../lib/decision-room-moves";
import type { TriedMove } from "./DecisionRoomMoveBar";

interface Props {
  board: DecisionRoomBoard;
  coachRead: string | null;
  recommendedMoves: RecommendedMove[];
  futureTicks: FutureTick[];
  moveHistory: TriedMove[];
}

function sanitizeFilename(text: string): string {
  return text
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "decision-room-brief";
}

export function DecisionRoomBriefExport({
  board,
  coachRead,
  recommendedMoves,
  futureTicks,
  moveHistory,
}: Props) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const markdown = buildRoomBriefMarkdown({
    board,
    coachRead,
    recommendedMoves,
    futureTicks,
    moveHistory,
  });

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      toast({ title: "Copied", description: "Decision Room brief on your clipboard." });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Select the text below and copy it manually.",
        variant: "destructive",
      });
    }
  }

  function handleDownload() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const dateTag = new Date().toISOString().slice(0, 10);
    const stem = sanitizeFilename(board.dealName ?? "decision-room");
    const link = document.createElement("a");
    link.href = url;
    link.download = `${stem}-${dateTag}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          Export brief
        </Button>
      </div>
    );
  }

  return (
    <DeckSurface className="border-qep-deck-rule bg-qep-deck-elevated/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <FileText className="h-3.5 w-3.5 text-qep-orange" />
          Shareable brief
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Markdown snapshot of the full Decision Room state — paste into a handoff doc, drop into a manager
        update, or bring to your next pipeline review.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={handleCopy} className="gap-1.5">
          <Copy className="h-3.5 w-3.5" />
          Copy markdown
        </Button>
        <Button type="button" size="sm" onClick={handleDownload} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          Download .md
        </Button>
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-qep-deck-rule bg-black/30 p-3 text-[11px] leading-relaxed text-foreground/80">
        {markdown}
      </pre>
    </DeckSurface>
  );
}
