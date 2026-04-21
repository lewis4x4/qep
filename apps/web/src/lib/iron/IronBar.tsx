/**
 * Wave 7.1 Iron Companion — IronBar (streaming chat + command palette).
 *
 * This is the main "ask Iron anything" surface. Cmd+I opens it. Inside:
 *   • A scrollable message thread (multi-turn, streamed token-by-token)
 *   • A free-text input + voice push-to-talk
 *   • A quick-action template grid (role-filtered, affinity-ranked)
 *   • Citation chips on every assistant message
 *   • Auto-narration via OpenAI TTS (sentence-buffered, barge-in safe)
 *
 * The send pipeline routes through the orchestrator FIRST so the
 * classifier can dispatch to a flow when the user's intent is clearly an
 * action. For READ_ANSWER (and as the default for ambiguous intents) it
 * streams from `iron-knowledge` — fused internal RAG + web search +
 * conversation history.
 *
 * The avatar reads its visual state from the global presence bus, which
 * the streaming hook + voice recorder + TTS all push into. The bar itself
 * stays passive — it never calls `setAvatar` directly.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import {
  Bot,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ironOrchestrate } from "./api";
import { useIronStore, type IronChatMessage } from "./store";
import { useIronVoiceRecorder } from "./voice/useIronVoiceRecorder";
import { ironTranscribe } from "./voice/api";
import { ironSpeak, cancelIronSpeech } from "./voice/tts";
import { isLikelySameSpeaker } from "./voice/voiceFingerprint";
import { useIronKnowledgeStream, type IronKnowledgeSource } from "./useIronKnowledgeStream";
import {
  filterAndRankTemplates,
  type IronTemplate,
} from "./templates";
import { AssistantResponseRenderer } from "@/components/assistant/AssistantResponseRenderer";
import { pushPresence } from "./presence";
import { supabase } from "@/lib/supabase";

interface SendOptions {
  /** "voice" auto-narrates the response. */
  mode?: "text" | "voice";
  /** When true, skip the classifier and go straight to iron-knowledge. */
  knowledgeOnly?: boolean;
}

export function IronBar() {
  const {
    state,
    openBar,
    closeBar,
    startFlow,
    setError,
    setNarrationEnabled,
    setLastInputMode,
    setCanonicalFingerprint,
    setMultiVoiceWarning,
    resetCanonicalFingerprint,
    chatAppend,
    chatPatchLast,
    chatReset,
    setConversationId,
  } = useIronStore();

  const [input, setInput] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [voicePending, setVoicePending] = useState(false);
  const [userRole, setUserRole] = useState<string>("rep");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const recorder = useIronVoiceRecorder();
  const knowledge = useIronKnowledgeStream();
  const pttActiveRef = useRef(false);

  const templates = useMemo(() => filterAndRankTemplates(userRole, []), [userRole]);

  // Pull stable fields off the knowledge stream so callbacks below don't
  // see a fresh `knowledge` object identity every render. The hook's
  // `start`/`cancel` are useCallbacks with stable deps, and the status
  // string IS expected to flip the deps when streaming begins/ends.
  const knowledgeStart = knowledge.start;
  const knowledgeCancel = knowledge.cancel;
  const knowledgeStatus = knowledge.status;

  // ── Cmd+I shortcut ────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "i") {
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

  // Auto-focus when bar opens; clear input on close (keep history!)
  useEffect(() => {
    if (state.barOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    } else {
      setInput("");
      setClassifying(false);
    }
  }, [state.barOpen]);

  // Scroll to bottom on new messages or stream tokens
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [state.chatMessages, knowledge.text, knowledge.status]);

  // Live-update the streaming assistant message in the store as tokens arrive
  useEffect(() => {
    if (knowledge.status === "streaming" || knowledge.status === "done") {
      chatPatchLast({
        content: knowledge.text,
        pending: knowledge.status !== "done",
        citations: knowledge.sources.map(citationFromSource),
      });
    }
    if (knowledge.status === "done" && knowledge.meta?.conversation_id) {
      setConversationId(knowledge.meta.conversation_id);
    }
    if (knowledge.status === "error" && knowledge.error) {
      chatPatchLast({
        content: `Iron hit an error: ${knowledge.error}`,
        pending: false,
      });
    }
  }, [knowledge.status, knowledge.text, knowledge.sources, knowledge.meta, knowledge.error, chatPatchLast, setConversationId]);

  // Lookup user role once when bar first opens
  useEffect(() => {
    if (!state.barOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id;
        if (!userId) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .maybeSingle();
        if (!cancelled && profile && typeof profile.role === "string") {
          setUserRole(profile.role);
        }
      } catch {
        /* role lookup is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.barOpen]);

  // ── Send pipeline ─────────────────────────────────────────────────────
  const send = useCallback(
    async (explicitText?: string, options: SendOptions = {}) => {
      const text = (explicitText ?? input).trim();
      if (!text || classifying || knowledgeStatus === "streaming") return;
      const mode = options.mode ?? "text";

      cancelIronSpeech();
      setLastInputMode(mode);
      setError(null);
      setInput("");

      // Append the user message + a placeholder assistant message that the
      // streaming hook will fill in.
      const userMsg: IronChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      chatAppend(userMsg);

      // Knowledge-only path: skip the classifier and stream directly.
      if (options.knowledgeOnly) {
        const placeholder: IronChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          pending: true,
          createdAt: Date.now(),
        };
        chatAppend(placeholder);
        await knowledgeStart({
          message: text,
          conversationId: state.conversationId ?? undefined,
          route: location.pathname,
        });
        return;
      }

      // Otherwise, classify first.
      setClassifying(true);
      const classifyRelease = pushPresence("iron-classify", "thinking");
      try {
        const res = await ironOrchestrate({
          text,
          conversation_id: state.conversationId ?? undefined,
          input_mode: mode,
          route: location.pathname,
        });

        if (!res.ok) {
          chatAppend({
            id: crypto.randomUUID(),
            role: "assistant",
            content: res.message ?? `Iron declined: ${res.category ?? "unknown"}`,
            createdAt: Date.now(),
          });
          return;
        }

        const cls = res.classification;
        if (!cls) {
          chatAppend({
            id: crypto.randomUUID(),
            role: "assistant",
            content: "Iron returned no classification.",
            createdAt: Date.now(),
          });
          return;
        }

        // ONLY explicit FLOW_DISPATCH hands off to the slot-fill UI. Every
        // other classification — CLARIFY, READ_ANSWER, AGENTIC_TASK,
        // HUMAN_ESCALATION, or no classification at all — falls through to
        // iron-knowledge. The agent has conversation history + real tools;
        // let IT decide how to respond. The orchestrator's job is ONLY to
        // detect explicit action triggers; it was never meant to be the
        // final responder for knowledge questions or ambiguous follow-ups.
        if (cls.category === "FLOW_DISPATCH" && res.flow_definition && res.conversation_id) {
          startFlow({
            flow: res.flow_definition,
            conversationId: res.conversation_id,
            prefilled: cls.prefilled_slots ?? {},
          });
          chatAppend({
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Starting ${res.flow_definition.name}…`,
            createdAt: Date.now(),
          });
          return;
        }

        // HUMAN_ESCALATION is a side-signal, not a terminal state. Flag
        // the presence bus so the operator sees the alert glow, but still
        // stream an answer from the agent — which may itself tell them
        // how to reach a manager with more context than the classifier had.
        if (cls.category === "HUMAN_ESCALATION") {
          pushPresence("iron-escalation", "alert", { ttlMs: 4000 });
        }

        // Everything else (READ_ANSWER, CLARIFY, AGENTIC_TASK, unknown) →
        // stream from iron-knowledge. The agent has conversation history
        // and tools, so it will resolve pronouns and follow-ups naturally.
        const placeholder: IronChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          pending: true,
          createdAt: Date.now(),
        };
        chatAppend(placeholder);
        if (res.conversation_id) setConversationId(res.conversation_id);
        await knowledgeStart({
          message: text,
          conversationId: res.conversation_id ?? state.conversationId ?? undefined,
          route: location.pathname,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Iron call failed";
        chatAppend({
          id: crypto.randomUUID(),
          role: "assistant",
          content: msg,
          createdAt: Date.now(),
        });
        setError(msg);
        pushPresence("iron-error", "alert", { ttlMs: 3000 });
      } finally {
        classifyRelease();
        setClassifying(false);
      }
    },
    [
      input,
      classifying,
      knowledgeStatus,
      knowledgeStart,
      state.conversationId,
      location.pathname,
      chatAppend,
      setError,
      setLastInputMode,
      startFlow,
      setConversationId,
    ],
  );

  // ── Voice flow ────────────────────────────────────────────────────────
  const startVoice = useCallback(async () => {
    if (recorder.state === "recording" || classifying || voicePending) return;
    cancelIronSpeech();
    pushPresence("iron-mic", "listening", { ttlMs: 30_000 });
    await recorder.start();
  }, [recorder, classifying, voicePending]);

  const stopAndTranscribe = useCallback(async () => {
    if (recorder.state !== "recording") return;
    setVoicePending(true);
    try {
      const result = await recorder.stop();
      if (!result) {
        chatAppend({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Didn't catch that — try again?",
          createdAt: Date.now(),
        });
        return;
      }

      // Multi-voice detection
      if (result.fingerprint.sampleCount >= 4) {
        if (!state.canonicalFingerprint) {
          setCanonicalFingerprint(result.fingerprint);
        } else if (!isLikelySameSpeaker(state.canonicalFingerprint, result.fingerprint)) {
          setMultiVoiceWarning(true);
        }
      }

      const transcribed = await ironTranscribe(result.blob, result.fileName);
      if (!transcribed.ok || !transcribed.transcript) {
        chatAppend({
          id: crypto.randomUUID(),
          role: "assistant",
          content: transcribed.message ?? "No speech detected.",
          createdAt: Date.now(),
        });
        return;
      }
      await send(transcribed.transcript, { mode: "voice" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Voice transcription failed";
      chatAppend({
        id: crypto.randomUUID(),
        role: "assistant",
        content: msg,
        createdAt: Date.now(),
      });
    } finally {
      setVoicePending(false);
    }
  }, [recorder, send, state.canonicalFingerprint, setCanonicalFingerprint, setMultiVoiceWarning, chatAppend]);

  const handleMicClick = useCallback(() => {
    if (recorder.state === "recording") {
      void stopAndTranscribe();
    } else {
      void startVoice();
    }
  }, [recorder.state, stopAndTranscribe, startVoice]);

  // Push-to-hold spacebar
  useEffect(() => {
    if (!state.barOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (input.length > 0) return;
      const active = document.activeElement;
      const isOurInput = active === inputRef.current;
      const isOtherInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (isOtherInput && !isOurInput) return;
      e.preventDefault();
      pttActiveRef.current = true;
      void startVoice();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (!pttActiveRef.current) return;
      pttActiveRef.current = false;
      e.preventDefault();
      void stopAndTranscribe();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [state.barOpen, input, startVoice, stopAndTranscribe]);

  // Cancel mid-stream voice + TTS on bar close. Pull stable refs out of
  // recorder + knowledge so the effect doesn't re-fire on every keystroke.
  useEffect(() => {
    if (!state.barOpen) {
      if (recorder.state === "recording") recorder.cancel();
      cancelIronSpeech();
      knowledgeCancel();
    }
  }, [state.barOpen, recorder, knowledgeCancel]);

  // Sentence-buffered narration: on done, speak the full assistant text.
  useEffect(() => {
    if (knowledge.status !== "done") return;
    if (!knowledge.text) return;
    const shouldNarrate = state.lastInputMode === "voice" || state.narrationEnabled;
    if (!shouldNarrate) return;
    cancelIronSpeech();
    void ironSpeak(knowledge.text, {
      onStart: () => pushPresence("iron-tts", "speaking", { ttlMs: 60_000 }),
    });
  }, [knowledge.status, knowledge.text, state.lastInputMode, state.narrationEnabled]);

  const handleTemplateClick = useCallback(
    (tpl: IronTemplate) => {
      // Always pre-fill, always focus, always park the cursor at the end so
      // the user can keep typing immediately. Templates with an empty phrase
      // would just clear the input — no template currently ships empty.
      setInput(tpl.phrase);
      setTimeout(() => {
        inputRef.current?.focus();
        const len = tpl.phrase.length;
        inputRef.current?.setSelectionRange(len, len);
      }, 10);
    },
    [],
  );

  const startNewConversation = useCallback(() => {
    knowledge.cancel();
    cancelIronSpeech();
    chatReset();
  }, [knowledge, chatReset]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <Dialog open={state.barOpen} onOpenChange={(open) => (open ? openBar() : closeBar())}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border p-3">
          <div>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-qep-orange" /> Iron
            </DialogTitle>
            <DialogDescription className="text-[11px] text-muted-foreground">
              Type, speak, or hold space — Cmd+I toggles. Iron answers from QEP data, manuals, and the web.
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={startNewConversation}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            aria-label="Start a new Iron conversation"
            title="Start a new conversation"
          >
            <Plus className="h-3 w-3" />
            New chat
          </button>
        </DialogHeader>

        {/* Multi-voice warning banner */}
        {state.multiVoiceWarning && (
          <div className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
            <Bot className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-amber-300">Heads up — I'm hearing a second voice.</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Iron will keep going, but if someone else just took over, double-check the next confirmation step.
              </p>
            </div>
            <button
              type="button"
              onClick={() => resetCanonicalFingerprint()}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/30"
              aria-label="Dismiss multi-voice warning"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Message thread */}
        <div
          ref={scrollRef}
          className="max-h-[60vh] min-h-[160px] overflow-y-auto px-3 py-3"
        >
          {state.chatMessages.length === 0 ? (
            <EmptyState templates={templates} onTemplateClick={handleTemplateClick} />
          ) : (
            <div className="flex flex-col gap-3">
              {state.chatMessages.map((msg) => (
                <ChatBubble key={msg.id} message={msg} />
              ))}
            </div>
          )}
        </div>

        {/* Input row */}
        <div className="border-t border-border">
          <div className="flex items-center gap-2 px-3 py-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={classifying || voicePending || knowledgeStatus === "streaming"}
              placeholder={
                recorder.state === "recording"
                  ? "Listening… release space or tap stop"
                  : knowledgeStatus === "streaming"
                  ? "Iron is answering — hang on…"
                  : classifying
                  ? "Iron is thinking…"
                  : "Ask anything, or pull a part, log a service call…"
              }
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => {
                const next = !state.narrationEnabled;
                setNarrationEnabled(next);
                if (!next) cancelIronSpeech();
              }}
              className={`rounded-md p-1.5 transition-colors ${
                state.narrationEnabled
                  ? "bg-qep-orange/10 text-qep-orange"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
              aria-label={state.narrationEnabled ? "Mute Iron narration" : "Let Iron speak"}
              title={state.narrationEnabled ? "Iron will speak responses (click to mute)" : "Iron is silent (click to enable narration)"}
            >
              {state.narrationEnabled ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleMicClick}
              disabled={classifying || voicePending || knowledgeStatus === "streaming"}
              className={`rounded-md p-1.5 transition-colors disabled:opacity-30 ${
                recorder.state === "recording"
                  ? "bg-red-500/15 text-red-400 animate-pulse"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
              aria-label={recorder.state === "recording" ? "Stop recording" : "Start recording"}
            >
              {recorder.state === "error" ? (
                <MicOff className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={classifying || voicePending || input.trim().length === 0 || knowledge.status === "streaming"}
              className="rounded-md bg-qep-orange/10 p-1.5 text-qep-orange hover:bg-qep-orange/20 disabled:opacity-30"
              aria-label="Send to Iron"
            >
              {classifying || knowledge.status === "streaming" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* Voice level meter */}
          {recorder.state === "recording" && (
            <div className="mx-3 mb-1 h-1 overflow-hidden rounded-full bg-muted/30">
              <div
                className="h-full bg-red-400 transition-[width] duration-75"
                style={{ width: `${Math.round(recorder.level * 100)}%` }}
              />
            </div>
          )}
          {recorder.errorMessage && (
            <div className="mx-3 mb-1 flex items-center gap-1.5 text-[10px] text-red-400">
              <MicOff className="h-3 w-3" /> {recorder.errorMessage}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function citationFromSource(source: IronKnowledgeSource): NonNullable<IronChatMessage["citations"]>[number] {
  return {
    id: source.id,
    title: source.title,
    kind: source.kind,
    marker: source.marker,
    url: source.url,
    excerpt: source.excerpt,
  };
}

function ChatBubble({ message }: { message: IronChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
          isUser
            ? "bg-qep-orange/15 text-foreground"
            : "border border-border/60 bg-muted/20 text-foreground"
        }`}
      >
        {isUser ? (
          <>
            {message.content || (message.pending ? <PendingIndicator /> : null)}
            {message.pending && message.content && <PendingIndicator inline />}
          </>
        ) : (
          <>
            {message.content ? (
              <AssistantResponseRenderer content={message.content} variant="iron_compact" />
            ) : (
              message.pending ? <PendingIndicator /> : null
            )}
            {message.pending && message.content && <PendingIndicator inline />}
          </>
        )}
        {message.citations && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.citations.map((cite) => (
              <CitationChip key={cite.id} citation={cite} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PendingIndicator({ inline = false }: { inline?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-muted-foreground ${inline ? "ml-1" : ""}`}>
      <Loader2 className="h-3 w-3 animate-spin" />
      {!inline && <span className="text-[11px]">thinking…</span>}
    </span>
  );
}

function CitationChip({
  citation,
}: {
  citation: NonNullable<IronChatMessage["citations"]>[number];
}) {
  const Tag = citation.url ? "a" : "span";
  const colorMap: Record<string, string> = {
    document: "border-blue-500/30 bg-blue-500/5 text-blue-300",
    crm: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
    service_kb: "border-purple-500/30 bg-purple-500/5 text-purple-300",
    web: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  };
  return (
    <Tag
      {...(citation.url
        ? { href: citation.url, target: "_blank", rel: "noopener noreferrer" }
        : {})}
      title={citation.excerpt ?? citation.title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
        colorMap[citation.kind] ?? "border-border/40 bg-muted/20 text-muted-foreground"
      }`}
    >
      {citation.marker && <span className="font-mono opacity-70">{citation.marker}</span>}
      <span className="max-w-[160px] truncate">{citation.title}</span>
    </Tag>
  );
}

function EmptyState({
  templates,
  onTemplateClick,
}: {
  templates: IronTemplate[];
  onTemplateClick: (tpl: IronTemplate) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <p className="text-center text-[11px] uppercase tracking-wider text-muted-foreground/70">
        Try one of these — or just ask anything
      </p>
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
        {templates.slice(0, 12).map((tpl) => {
          const Icon = tpl.icon;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onTemplateClick(tpl)}
              className="group flex flex-col items-start gap-1 rounded-lg border border-border/50 bg-muted/10 p-2 text-left transition-colors hover:border-qep-orange/40 hover:bg-qep-orange/5"
            >
              <Icon className="h-3.5 w-3.5 text-qep-orange/80 group-hover:text-qep-orange" />
              <span className="text-[12px] font-medium leading-tight text-foreground">
                {tpl.label}
              </span>
              <span className="text-[10px] leading-tight text-muted-foreground/80">
                {tpl.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
