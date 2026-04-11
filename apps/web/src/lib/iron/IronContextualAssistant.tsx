import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  Loader2,
  MessageSquareDashed,
  Pin,
  RefreshCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useIronKnowledgeStream, type IronKnowledgeSource } from "./useIronKnowledgeStream";
import {
  useIronStore,
  type IronChatMessage,
} from "./store";
import { AssistantResponseRenderer } from "@/components/assistant/AssistantResponseRenderer";

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

function ContextualChatBubble({ message }: { message: IronChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed",
          isUser
            ? "bg-qep-orange/15 text-white"
            : "border border-white/10 bg-white/[0.04] text-slate-100"
        )}
      >
        {isUser ? (
          <>
            {message.content || (message.pending ? <InlinePendingIndicator /> : null)}
            {message.pending && message.content && <InlinePendingIndicator className="ml-2" />}
          </>
        ) : (
          <>
            {message.content ? (
              <AssistantResponseRenderer content={message.content} variant="sidecar" />
            ) : (
              message.pending ? <InlinePendingIndicator /> : null
            )}
            {message.pending && message.content && <InlinePendingIndicator className="ml-2" />}
          </>
        )}
        {message.citations && message.citations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.citations.map((citation) => (
              <CitationChip key={citation.id} citation={citation} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CitationChip({
  citation,
}: {
  citation: NonNullable<IronChatMessage["citations"]>[number];
}) {
  const toneMap: Record<string, string> = {
    document: "border-blue-500/30 bg-blue-500/10 text-blue-200",
    crm: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    service_kb: "border-purple-500/30 bg-purple-500/10 text-purple-200",
    web: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  };
  const Tag = citation.url ? "a" : "span";
  return (
    <Tag
      {...(citation.url
        ? { href: citation.url, target: "_blank", rel: "noopener noreferrer" }
        : {})}
      title={citation.excerpt ?? citation.title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px]",
        toneMap[citation.kind] ?? "border-white/10 bg-white/[0.04] text-slate-300",
      )}
    >
      {citation.marker && <span className="font-mono opacity-70">{citation.marker}</span>}
      <span className="max-w-[180px] truncate">{citation.title}</span>
    </Tag>
  );
}

function InlinePendingIndicator({ className = "" }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-slate-400", className)}>
      <Loader2 className="h-3 w-3 animate-spin" />
      <span className="text-[11px]">thinking…</span>
    </span>
  );
}

interface ContextualAssistantPanelProps {
  embedded?: boolean;
  onClose?: () => void;
  className?: string;
}

export function IronContextualAssistantPanel({
  embedded = false,
  onClose,
  className,
}: ContextualAssistantPanelProps) {
  const {
    state,
    closeContextualAssistant,
    chatAppend,
    chatPatchLast,
    chatReset,
    setConversationId,
    setError,
    setLastInputMode,
  } = useIronStore();
  const navigate = useNavigate();
  const location = useLocation();
  const knowledge = useIronKnowledgeStream();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.contextualOpen || !state.activeContext) return;
    setInput(state.draftPrompt);
    setTimeout(() => {
      inputRef.current?.focus();
      const len = state.draftPrompt.length;
      inputRef.current?.setSelectionRange(len, len);
    }, 30);
  }, [state.contextNonce, state.contextualOpen, state.activeContext, state.draftPrompt]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [state.chatMessages, knowledge.text, knowledge.status]);

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
      setError(knowledge.error);
    }
  }, [
    knowledge.error,
    knowledge.meta,
    knowledge.sources,
    knowledge.status,
    knowledge.text,
    chatPatchLast,
    setConversationId,
    setError,
  ]);

  useEffect(() => {
    if (state.contextualOpen) return;
    knowledge.cancel();
  }, [state.contextualOpen, knowledge]);

  const activeContext = state.activeContext;

  const send = useCallback(
    async (explicitText?: string) => {
      const text = (explicitText ?? input).trim();
      if (!text || !activeContext || knowledge.status === "streaming") return;

      setLastInputMode("text");
      setError(null);
      setInput("");

      chatAppend({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      });
      chatAppend({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        pending: true,
        createdAt: Date.now(),
      });

      await knowledge.start({
        message: text,
        conversationId: state.conversationId ?? undefined,
        route: activeContext.route || location.pathname,
        context: activeContext,
      });
    },
    [
      activeContext,
      input,
      knowledge,
      location.pathname,
      chatAppend,
      setError,
      setLastInputMode,
      state.conversationId,
    ],
  );

  const handleOpenFullConversation = useCallback(() => {
    if (!activeContext) return;
    navigate(
      activeContext.entityId
        ? `/chat?context_type=${encodeURIComponent(activeContext.kind)}&context_id=${encodeURIComponent(activeContext.entityId)}`
        : `/chat?context_type=${encodeURIComponent(activeContext.kind)}`,
      {
        state: {
          askIronContext: {
            contextType: activeContext.kind,
            contextId: activeContext.entityId ?? null,
          },
        },
      },
    );
    closeContextualAssistant();
    onClose?.();
  }, [activeContext, closeContextualAssistant, navigate, onClose]);

  if (!activeContext) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.94))] text-white",
        className,
      )}
    >
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-qep-orange" />
              <p className="text-sm font-semibold tracking-tight">Ask Iron</p>
              <span className="rounded-full border border-qep-orange/20 bg-qep-orange/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-qep-orange">
                Live Context
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Iron stays in the flow with you and answers from the current operating context.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-slate-300 hover:bg-white/10 hover:text-white"
              onClick={() => {
                knowledge.reset();
                chatReset();
                setInput(activeContext.draftPrompt);
              }}
            >
              <RefreshCcw className="mr-1 h-3.5 w-3.5" />
              New thread
            </Button>
            {!embedded && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-slate-300 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  closeContextualAssistant();
                  onClose?.();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-200">
            <Pin className="h-3 w-3 text-qep-orange" />
            {activeContext.title}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {activeContext.route}
          </span>
        </div>

        {activeContext.evidence && (
          <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3 text-[11px] leading-5 text-slate-300">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Context Evidence
            </p>
            <p className="line-clamp-5 whitespace-pre-wrap">{activeContext.evidence}</p>
          </div>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {state.chatMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <MessageSquareDashed className="h-10 w-10 text-qep-orange/70" />
            <div className="max-w-sm">
              <p className="text-base font-semibold text-white">Iron is pinned to this workflow.</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Edit the drafted prompt below or ask any follow-up. Iron keeps the current context pinned while you work.
              </p>
            </div>
          </div>
        ) : (
          state.chatMessages.map((message) => (
            <ContextualChatBubble key={message.id} message={message} />
          ))
        )}
      </div>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-400">
            Context-aware thread: Iron prioritizes the pinned route and evidence before broad search.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-full border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
            onClick={handleOpenFullConversation}
          >
            Open full chat
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={3}
            placeholder="Ask Iron about what you’re seeing right now…"
            className="min-h-[88px] flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-qep-orange/40 focus:ring-2 focus:ring-qep-orange/20"
          />
          <Button
            size="icon"
            className="h-11 w-11 rounded-2xl bg-qep-orange text-white hover:bg-qep-orange-hover"
            disabled={knowledge.status === "streaming" || input.trim().length === 0}
            onClick={() => void send()}
          >
            {knowledge.status === "streaming" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function IronContextualAssistantSheet() {
  const { state, closeContextualAssistant } = useIronStore();
  const open =
    state.contextualOpen &&
    !!state.activeContext &&
    state.activeContext.preferredSurface !== "metric_drawer";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeContextualAssistant();
      }}
    >
      <SheetContent
        side="right"
        className="w-full max-w-none border-l border-white/10 bg-transparent p-4 sm:max-w-[560px]"
      >
        <IronContextualAssistantPanel
          embedded
          className="h-[calc(100vh-2rem)]"
          onClose={closeContextualAssistant}
        />
      </SheetContent>
    </Sheet>
  );
}
