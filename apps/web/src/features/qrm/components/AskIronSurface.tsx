/**
 * AskIronSurface — the "ambient agent" surface in the 4-surface shell.
 *
 * Where Today is "what should I do next?", Pulse is "what changed?", and
 * Graph is "show me the entities" — Ask Iron is the conversation. An
 * operator types a question, Claude Sonnet 4.6 picks tools, the answer
 * comes back grounded in real QRM rows.
 *
 * This component is feature-flagged via shell_v2 and rendered on
 * /qrm/operations-copilot when the flag is on. The legacy
 * OperationsCopilotPage (a deterministic board of recommendations) is
 * preserved behind the flag for non-flagged users.
 *
 * Zero-blocking degrade: if the edge function returns 503 (ANTHROPIC_API_KEY
 * not configured), we surface a clear "assistant is offline" state so the
 * shell still looks intentional.
 */

import { FormEvent, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Send, Loader2, AlertCircle, Wrench, CornerDownRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  askIron,
  AskIronOfflineError,
} from "../lib/ask-iron-api";
import type { AskIronMessage } from "../lib/ask-iron-types";
import {
  buildHistoryPayload,
  humanizeToolName,
  SUGGESTED_STARTERS,
  summarizeToolTrace,
} from "./askIronHelpers";

export function AskIronSurface() {
  const [messages, setMessages] = useState<AskIronMessage[]>([]);
  const [input, setInput] = useState("");
  const [offline, setOffline] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const askMutation = useMutation({
    mutationFn: async (question: string) => {
      return askIron({
        question,
        history: buildHistoryPayload(messages),
      });
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          toolTrace: data.tool_trace,
        },
      ]);
      // After the assistant replies, auto-scroll to the newest message on the
      // next paint. Using rAF avoids a layout thrash inside onSuccess.
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    },
    onError: (err) => {
      if (err instanceof AskIronOfflineError) {
        setOffline(true);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Iron stumbled: ${(err as Error).message}`,
        },
      ]);
    },
  });

  const send = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || askMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    askMutation.mutate(trimmed);
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send(input);
  };

  const showStarters = messages.length === 0 && !askMutation.isPending;

  return (
    <div className="mx-auto flex h-[calc(100vh-10rem)] w-full max-w-4xl flex-col gap-3 px-4 pt-2 sm:px-6">
      <header className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-qep-orange/10">
          <Sparkles className="h-5 w-5 text-qep-orange" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Ask Iron</h1>
          <p className="text-xs text-muted-foreground">
            The ambient agent. Grounded in your moves, signals, and graph.
          </p>
        </div>
      </header>

      {offline ? <OfflineBanner /> : null}

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-border/50 bg-background/40 p-4"
      >
        {showStarters ? <StarterGrid onPick={(q) => send(q)} /> : null}

        {messages.map((m, idx) => (
          <MessageBubble key={idx} message={m} />
        ))}

        {askMutation.isPending ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Iron is thinking…
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={offline ? "Ask Iron is offline" : "Ask Iron a question…"}
          disabled={offline || askMutation.isPending}
          className={cn(
            "flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm",
            "placeholder:text-muted-foreground",
            "focus:border-qep-orange focus:outline-none",
            "disabled:opacity-50",
          )}
          aria-label="Ask Iron a question"
        />
        <Button
          type="submit"
          disabled={offline || askMutation.isPending || !input.trim()}
          className="shrink-0"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Send</span>
        </Button>
      </form>
    </div>
  );
}

function StarterGrid({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Try asking
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {SUGGESTED_STARTERS.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onPick(starter)}
            className={cn(
              "rounded-lg border border-border bg-muted/30 px-3 py-2 text-left text-sm",
              "transition-colors hover:border-qep-orange/60 hover:bg-muted/60",
            )}
          >
            <CornerDownRight className="mr-2 inline h-3.5 w-3.5 text-qep-orange" aria-hidden="true" />
            {starter}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: AskIronMessage }) {
  const isUser = message.role === "user";
  const trace = useMemo(
    () => summarizeToolTrace(message.toolTrace),
    [message.toolTrace],
  );

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
          isUser
            ? "bg-qep-orange text-white"
            : "bg-muted/60 text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {!isUser && message.toolTrace && message.toolTrace.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
            {message.toolTrace.map((t, idx) => (
              <span
                key={idx}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  t.ok
                    ? "bg-background/60 text-muted-foreground"
                    : "bg-red-500/10 text-red-400",
                )}
                title={t.ok ? "Tool completed" : "Tool failed"}
              >
                <Wrench className="h-3 w-3" aria-hidden="true" />
                {humanizeToolName(t.tool)}
              </span>
            ))}
            {(trace.moves + trace.signals + trace.entities) > 0 ? (
              <span className="text-[10px] text-muted-foreground">
                Touched{" "}
                {trace.moves > 0 ? `${trace.moves} moves · ` : ""}
                {trace.signals > 0 ? `${trace.signals} signals · ` : ""}
                {trace.entities > 0 ? `${trace.entities} entities` : ""}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OfflineBanner() {
  return (
    <Card className="flex items-start gap-3 border-amber-500/30 bg-amber-500/5 p-3">
      <AlertCircle className="mt-0.5 h-4 w-4 text-amber-400" aria-hidden="true" />
      <div className="text-xs">
        <p className="font-medium text-amber-300">Ask Iron is offline</p>
        <p className="mt-0.5 text-muted-foreground">
          The assistant isn't configured yet (ANTHROPIC_API_KEY missing on the
          edge function). Other QRM surfaces continue to work.
        </p>
      </div>
    </Card>
  );
}
