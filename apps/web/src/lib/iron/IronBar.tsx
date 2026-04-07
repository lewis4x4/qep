/**
 * Wave 7 Iron Companion — IronBar (command palette + chat input).
 *
 * Built on cmdk + Radix Dialog (already in the repo). Pressing Cmd+I (or
 * Ctrl+I on Windows/Linux) opens the bar. Typing or speaking sends the
 * intent to iron-orchestrator. On FLOW_DISPATCH the bar closes and
 * FlowEngineUI mounts to walk slot fills.
 *
 * Cmd+K is intentionally NOT used because the existing QrmGlobalSearchCommand
 * already binds it. Cmd+I = "Iron".
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Command } from "cmdk";
import { Loader2, Send, Sparkles, Bot, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ironOrchestrate } from "./api";
import { useIronStore } from "./store";

export function IronBar() {
  const { state, openBar, closeBar, startFlow, setAvatar, setError } = useIronStore();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();

  // Cmd+I / Ctrl+I shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (!cmd) return;
      if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        if (state.barOpen) {
          closeBar();
        } else {
          openBar();
        }
      } else if (e.key === "Escape" && state.barOpen) {
        closeBar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.barOpen, openBar, closeBar]);

  // Auto-focus input when bar opens
  useEffect(() => {
    if (state.barOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    } else {
      // Reset on close
      setInput("");
      setResponse(null);
      setPending(false);
    }
  }, [state.barOpen]);

  async function submit() {
    const text = input.trim();
    if (!text || pending) return;
    setPending(true);
    setResponse(null);
    setError(null);
    setAvatar("thinking");
    try {
      const res = await ironOrchestrate({
        text,
        conversation_id: state.conversationId ?? undefined,
        input_mode: "text",
        route: location.pathname,
      });
      if (!res.ok) {
        setResponse(res.message ?? `Iron declined: ${res.category ?? "unknown"}`);
        setAvatar("alert");
        return;
      }
      const cls = res.classification;
      if (!cls) {
        setResponse("Iron returned no classification.");
        setAvatar("alert");
        return;
      }

      if (cls.category === "FLOW_DISPATCH" && res.flow_definition && res.conversation_id) {
        startFlow({
          flow: res.flow_definition,
          conversationId: res.conversation_id,
          prefilled: cls.prefilled_slots ?? {},
        });
        return;
      }

      if (cls.category === "CLARIFY") {
        setResponse(cls.clarification_needed ?? "Could you rephrase?");
        setAvatar("idle");
        return;
      }

      if (cls.category === "READ_ANSWER") {
        setResponse(`I can answer that — try asking it on the dashboard. (${cls.answer_query ?? ""})`);
        setAvatar("idle");
        return;
      }

      if (cls.category === "AGENTIC_TASK") {
        setResponse(`Logged for follow-up: ${cls.agentic_brief ?? "(no brief)"}`);
        setAvatar("idle");
        return;
      }

      if (cls.category === "HUMAN_ESCALATION") {
        setResponse(`Flagged for a manager: ${cls.escalation_reason ?? "human help requested"}`);
        setAvatar("alert");
        return;
      }

      setResponse(`Iron returned: ${cls.category}`);
      setAvatar("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Iron call failed";
      setResponse(message);
      setError(message);
      setAvatar("alert");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={state.barOpen} onOpenChange={(open) => (open ? openBar() : closeBar())}>
      <DialogContent className="max-w-2xl gap-3 p-0">
        <DialogHeader className="border-b border-border p-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-qep-orange" /> Iron
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Tell Iron what you need. Cmd+I to toggle. Voice coming soon.
          </DialogDescription>
        </DialogHeader>

        <Command className="bg-transparent">
          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              disabled={pending}
              placeholder="Pull a part for Anderson, log a service call, draft a follow-up email…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={pending || input.trim().length === 0}
              className="rounded-md bg-qep-orange/10 p-1.5 text-qep-orange hover:bg-qep-orange/20 disabled:opacity-30"
              aria-label="Send to Iron"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>

          {response && (
            <div className="mx-3 my-2 rounded border border-border/60 bg-muted/20 p-2 text-[12px] text-foreground">
              {response.includes("declined") || response.includes("failed") ? (
                <span className="flex items-start gap-1.5 text-amber-400">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  {response}
                </span>
              ) : (
                response
              )}
            </div>
          )}

          <div className="border-t border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Try:&nbsp;
            <span className="text-foreground">"pull part 4521 for Anderson"</span>&nbsp;·&nbsp;
            <span className="text-foreground">"log a service call"</span>&nbsp;·&nbsp;
            <span className="text-foreground">"draft a follow-up to John"</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
