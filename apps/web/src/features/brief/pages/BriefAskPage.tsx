/**
 * /brief/ask — "Ask the Project Brain".
 *
 * Single-input Q&A surface backed by hub-ask-brain (pgvector retrieval +
 * Claude Sonnet 4.6 synthesis). Renders the answer with inline [n] citations,
 * and a citation rail below that opens each chunk + links out to the Drive /
 * NotebookLM source.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  BrainCircuit,
  ExternalLink,
  Loader2,
  MessageSquareQuote,
  Send,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  askProjectBrain,
  type AskBrainCitation,
  type AskBrainResponse,
} from "../lib/brief-api";

const SUGGESTED_QUESTIONS = [
  "What changed in the parts module this week?",
  "Why did we go with Supabase over M365?",
  "Which feedback items are still open?",
  "When did we ship the feedback loop?",
];

export function BriefAskPage() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<AskBrainResponse | null>(null);
  const [expandedCitation, setExpandedCitation] = useState<number | null>(null);
  const { toast } = useToast();

  const askMutation = useMutation({
    mutationFn: (q: string) => askProjectBrain(q),
    onSuccess: (data) => {
      setResponse(data);
      setExpandedCitation(null);
    },
    onError: (err: unknown) => {
      toast({
        title: "Couldn't reach the brain",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    askMutation.mutate(trimmed);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <div className="flex items-start gap-3">
        <BrainCircuit className="mt-1 h-5 w-5 text-muted-foreground" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Ask the Project Brain
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every answer cites a changelog entry, decision, or spec. No hallucinations,
            no guesswork.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(query);
        }}
        className="mt-6 flex gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What shipped this week? Why did we pick pgvector?"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
          maxLength={2000}
        />
        <Button type="submit" disabled={askMutation.isPending || query.trim().length === 0}>
          {askMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Ask
            </>
          )}
        </Button>
      </form>

      {!response && !askMutation.isPending && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4 text-sm text-card-foreground">
          <p className="text-foreground">Try one of these:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => submit(q)}
                className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-foreground transition hover:bg-accent hover:text-accent-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {askMutation.isPending && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching the project brain…
        </div>
      )}

      {response && (
        <section className="mt-6 space-y-4">
          <div className="rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs">
                {response.model} · {response.elapsed_ms}ms
              </Badge>
              {response.no_matches && (
                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">no matches</Badge>
              )}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {response.answer}
            </p>
          </div>

          {response.citations.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Citations
              </h2>
              <ul className="mt-2 space-y-2">
                {response.citations.map((c) => (
                  <CitationCard
                    key={c.index}
                    citation={c}
                    expanded={expandedCitation === c.index}
                    onToggle={() =>
                      setExpandedCitation((curr) => (curr === c.index ? null : c.index))
                    }
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function CitationCard({
  citation,
  expanded,
  onToggle,
}: {
  citation: AskBrainCitation;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="rounded-md border border-border bg-card text-sm text-card-foreground shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="flex items-start gap-2">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
            {citation.index}
          </span>
          <div>
            <p className="font-medium text-foreground">{citation.source_title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {citation.source_type} · similarity {citation.similarity.toFixed(2)}
              {citation.related_feedback_id && (
                <>
                  {" · "}
                  <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
                    <MessageSquareQuote className="h-3 w-3" aria-hidden />
                    submitter-driven
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <ArrowUpRight
          className={`h-4 w-4 text-muted-foreground transition ${expanded ? "rotate-45" : ""}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-3 text-xs text-foreground">
          <p className="whitespace-pre-wrap">{citation.body}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {citation.related_feedback_id && (
              // v2.3 "Remembered" tenet: show the stakeholder the actual row
              // their feedback became, not just the resulting changelog.
              // Deep-links to /brief/feedback with the row-id anchored.
              <Link
                to={`/brief/feedback#${citation.related_feedback_id}`}
                className="inline-flex items-center text-sky-600 hover:underline dark:text-sky-400"
              >
                <MessageSquareQuote className="mr-1 h-3 w-3" aria-hidden />
                View original feedback
              </Link>
            )}
            {citation.notebooklm_source_id && (
              <a
                href={`https://drive.google.com/file/d/${citation.notebooklm_source_id}/view`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center text-sky-600 hover:underline dark:text-sky-400"
              >
                Open source in Drive
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
