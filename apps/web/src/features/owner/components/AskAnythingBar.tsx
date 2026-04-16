/**
 * AskAnythingBar — the cross-domain query surface.
 *
 * Slice B placeholder: renders the full-width input with disabled-state copy
 * explaining what's coming. The Claude tool-use edge function lands in Slice D.
 */
import { Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { askOwnerAnything, type OwnerAskAnythingResponse } from "../lib/owner-api";

export function AskAnythingBar() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<OwnerAskAnythingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await askOwnerAnything(question.trim());
      setAnswer(res);
    } catch (err) {
      setError((err as Error).message);
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(15,23,42,0.88))] p-4 sm:p-5">
      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-qep-orange" />
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about customers, parts, deals, cash, people…"
          className="min-h-[48px] flex-1 bg-transparent text-lg text-white placeholder:text-slate-500 focus:outline-none"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={!question.trim() || busy}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-qep-orange/30 bg-qep-orange/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-qep-orange transition hover:border-qep-orange/50 hover:bg-qep-orange/20 disabled:opacity-50"
        >
          {busy ? "Thinking" : "Ask"}
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
      {(answer || error) && (
        <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-relaxed text-slate-200">
          {error ? (
            <span className="text-rose-300">{error}</span>
          ) : (
            <>
              <p className="whitespace-pre-wrap">{answer?.answer}</p>
              {answer && answer.tool_trace?.length > 0 && (
                <details className="mt-3 text-xs text-slate-500">
                  <summary className="cursor-pointer">
                    Tool trace ({answer.tool_trace.length})
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 p-2 text-[11px]">
                    {JSON.stringify(answer.tool_trace, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      )}
      {!answer && !error && (
        <p className="mt-3 text-xs text-slate-500">
          Powered by Claude Sonnet 4.6 with tool use across catalog search,
          deals, service, and intelligence. Edge function lands in Slice D.
        </p>
      )}
    </div>
  );
}
