import { useState } from "react";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { askDocumentViaRouter, type DocumentAskResponse } from "@/features/documents/router";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface AskBoxProps {
  documentId: string;
}

export function AskBox({ documentId }: AskBoxProps) {
  const [question, setQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<DocumentAskResponse | null>(null);
  const { toast } = useToast();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setResponse(null);
    try {
      const payload = await askDocumentViaRouter({ documentId, question: trimmed });
      setResponse(payload);
    } catch (err) {
      toast({
        title: "Ask failed",
        description: err instanceof Error ? err.message : "Could not answer the question.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Ask about this document
      </p>
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. What does Section 7 require on return inspection?"
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-qep-orange focus:ring-2 focus:ring-qep-orange/15"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!question.trim() || submitting}>
            {submitting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
            Ask
          </Button>
        </div>
      </form>

      {response ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">{response.answer}</p>
          {response.citations.length > 0 ? (
            <div className="space-y-1 border-t border-border/60 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Citations ({response.citations.length})
              </p>
              {response.citations.map((citation) => (
                <div
                  key={citation.chunkId}
                  className={cn(
                    "rounded-md border border-border/60 px-2 py-1 text-[11px]",
                    citation.confidence >= 0.8 ? "bg-emerald-500/5" : "",
                  )}
                >
                  <p className="text-[10px] font-medium text-muted-foreground">
                    {citation.sectionTitle ?? "Chunk"}
                    {citation.pageNumber !== null ? ` · p${citation.pageNumber}` : ""}
                    {" · "}
                    {(citation.confidence * 100).toFixed(0)}%
                  </p>
                  <p className="mt-0.5 italic text-foreground">"{citation.excerpt}"</p>
                </div>
              ))}
            </div>
          ) : response.answer.length > 0 ? (
            <p className="border-t border-border/60 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              No citations attached — answer may be unsupported
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
