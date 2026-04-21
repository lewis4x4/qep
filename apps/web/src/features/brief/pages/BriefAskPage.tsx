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
import { ArrowUpRight, BrainCircuit, ExternalLink, Loader2, Send } from "lucide-react";
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
        <BrainCircuit className="mt-1 h-5 w-5 text-slate-500" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Ask the Project Brain
          </h1>
          <p className="mt-1 text-sm text-slate-600">
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
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400"
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
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="text-slate-700">Try one of these:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => submit(q)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 transition hover:bg-slate-100"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {askMutation.isPending && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching the project brain…
        </div>
      )}

      {response && (
        <section className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs">
                {response.model} · {response.elapsed_ms}ms
              </Badge>
              {response.no_matches && (
                <Badge className="bg-amber-100 text-amber-900">no matches</Badge>
              )}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-900">
              {response.answer}
            </p>
          </div>

          {response.citations.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
    <li className="rounded-md border border-slate-200 bg-white text-sm shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="flex items-start gap-2">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-800 px-1.5 text-xs font-semibold text-white">
            {citation.index}
          </span>
          <div>
            <p className="font-medium text-slate-900">{citation.source_title}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {citation.source_type} · similarity {citation.similarity.toFixed(2)}
            </p>
          </div>
        </div>
        <ArrowUpRight
          className={`h-4 w-4 text-slate-400 transition ${expanded ? "rotate-45" : ""}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-3 py-3 text-xs text-slate-700">
          <p className="whitespace-pre-wrap">{citation.body}</p>
          {citation.notebooklm_source_id && (
            <a
              href={`https://drive.google.com/file/d/${citation.notebooklm_source_id}/view`}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-flex items-center text-sky-700 hover:underline"
            >
              Open source in Drive
              <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </li>
  );
}
