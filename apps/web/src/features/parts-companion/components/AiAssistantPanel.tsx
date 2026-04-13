import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  ArrowRight,
  FileText,
  Mic,
  Search,
  ArrowLeftRight,
  Wrench,
  Gauge,
  LayoutList,
  TrendingUp,
  PackageCheck,
  Sparkles,
} from "lucide-react";
import {
  useIronKnowledgeStream,
  type IronKnowledgeSource,
} from "../../../lib/iron/useIronKnowledgeStream";
import { IronAvatar } from "../../../lib/iron/IronAvatar";
import type { AiMessage } from "../lib/types";

/* ── Design tokens ─────────────────────────────────────────────── */
const T = {
  bg: "#0A1628",
  bgElevated: "#0F1D31",
  card: "#132238",
  cardHover: "#182A44",
  border: "#1F3254",
  borderSoft: "#18263F",
  orange: "#E87722",
  orangeGlow: "rgba(232,119,34,0.15)",
  orangeDeep: "rgba(232,119,34,0.35)",
  text: "#E5ECF5",
  textMuted: "#8A9BB4",
  textDim: "#5F7391",
  success: "#22C55E",
  successBg: "rgba(34,197,94,0.12)",
} as const;

interface AiAssistantPanelProps {
  onClose: () => void;
}

/** Map iron-knowledge sources to AiMessage citation shape */
function sourcesToCitations(
  sources: IronKnowledgeSource[],
): AiMessage["citations"] {
  return sources.map((s) => ({
    title: s.title,
    source: s.kind,
    page_number: undefined,
    excerpt: s.excerpt,
  }));
}

const SUGGESTIONS: Array<{ icon: typeof Search; label: string; prompt: string }> = [
  { icon: Search, label: "Part search", prompt: "What oil filter fits a Barko 495ML?" },
  { icon: ArrowLeftRight, label: "Cross-reference", prompt: "Cross-reference NAPA 1515 to OEM" },
  { icon: Wrench, label: "Service kit", prompt: "500-hour service kit for ASV RT-75?" },
  { icon: Gauge, label: "Torque spec", prompt: "Torque spec for track tensioner bolts?" },
  { icon: LayoutList, label: "Queue status", prompt: "Show me current parts queue status" },
  { icon: TrendingUp, label: "Top parts", prompt: "What are the top-selling parts this month?" },
  { icon: PackageCheck, label: "Reorders", prompt: "Which parts need reordering soon?" },
  { icon: Sparkles, label: "Upsell opportunities", prompt: "Identify upsell opportunities for recent orders" },
];

export function AiAssistantPanel({ onClose }: AiAssistantPanelProps) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);

  const stream = useIronKnowledgeStream();

  // Auto-scroll to bottom on new messages or streaming text
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, stream.text]);

  // When streaming completes, commit the response as a message
  useEffect(() => {
    if (stream.status === "done" && stream.text) {
      const aiMsg: AiMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: stream.text,
        citations: sourcesToCitations(stream.sources),
        created_at: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      if (stream.meta?.conversation_id) {
        setConversationId(stream.meta.conversation_id);
      }
      stream.reset();
    }
  }, [stream.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // When streaming errors, commit error as a message
  useEffect(() => {
    if (stream.status === "error" && stream.error) {
      const errMsg: AiMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Sorry, I couldn't complete that request. ${stream.error}`,
        created_at: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
      stream.reset();
    }
  }, [stream.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    async (text?: string) => {
      const message = (text ?? input).trim();
      if (!message || stream.status === "streaming" || stream.status === "connecting") return;

      const userMsg: AiMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        created_at: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");

      await stream.start({
        message,
        conversationId,
        route: "/parts/companion",
        enableWeb: false,
        context: null,
      });
    },
    [input, stream, conversationId],
  );

  const isStreaming = stream.status === "streaming" || stream.status === "connecting";

  return (
    <div
      className="flex flex-col h-full flex-shrink-0"
      style={{
        width: 480,
        background: T.bgElevated,
        borderLeft: `1px solid ${T.border}`,
        boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0"
        style={{
          background: `linear-gradient(180deg, ${T.orangeGlow} 0%, transparent 100%)`,
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ padding: "16px 20px" }}
        >
          <div className="flex items-center gap-3">
            <IronAvatar
              state={isStreaming ? "thinking" : "idle"}
              size={40}
            />
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[15px] font-bold"
                  style={{ color: T.text }}
                >
                  Iron
                </span>
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{
                    background: T.successBg,
                    color: T.success,
                  }}
                >
                  Online
                </span>
                {stream.meta?.degradation_state === "reduced" && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                    style={{ background: "rgba(245,158,11,0.15)", color: "#F59E0B" }}
                  >
                    Reduced
                  </span>
                )}
              </div>
              <div
                className="text-[11px] mt-0.5"
                style={{ color: T.textDim }}
              >
                Parts counter copilot &middot; inventory &middot; cross-refs &middot; specs
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="border-none bg-transparent cursor-pointer p-1.5 rounded-lg transition-colors duration-150"
            style={{ color: T.textMuted }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.card)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Messages ────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto flex flex-col gap-3"
        style={{ padding: "16px 20px" }}
      >
        {/* Suggestion grid when conversation is fresh */}
        {messages.length < 3 && !isStreaming && messages.length === 0 && (
          <div className="flex flex-col gap-4 mt-2">
            <p
              className="text-[13px] text-center"
              style={{ color: T.textMuted }}
            >
              Ask about parts, specs, maintenance, or cross-references.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SUGGESTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.label}
                    onClick={() => handleSend(s.prompt)}
                    className="flex items-center gap-2.5 text-left rounded-lg cursor-pointer transition-all duration-150"
                    style={{
                      padding: "10px 12px",
                      background: T.card,
                      border: `1px solid ${T.border}`,
                      color: T.text,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = T.orange;
                      e.currentTarget.style.background = T.orangeGlow;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = T.border;
                      e.currentTarget.style.background = T.card;
                    }}
                  >
                    <Icon size={14} style={{ color: T.orange, flexShrink: 0 }} />
                    <span className="text-[12px] font-medium">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`max-w-[85%] ${msg.role === "user" ? "self-end" : "self-start"}`}
          >
            <div
              className="rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap"
              style={{
                padding: "10px 14px",
                background: msg.role === "user" ? T.orange : T.card,
                color: T.text,
                border:
                  msg.role === "assistant"
                    ? `1px solid ${T.border}`
                    : "none",
              }}
            >
              {msg.content}
            </div>
            {msg.citations && msg.citations.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {msg.citations.map((cite, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px]"
                    style={{
                      background: T.card,
                      border: `1px solid ${T.borderSoft}`,
                      color: T.textMuted,
                    }}
                  >
                    <FileText size={10} />
                    {cite.title}
                    {cite.page_number ? `, pg ${cite.page_number}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Live streaming bubble */}
        {isStreaming && (
          <div className="self-start max-w-[85%]">
            <div
              className="rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap"
              style={{
                padding: "10px 14px",
                background: T.card,
                color: T.text,
                border: `1px solid ${T.border}`,
              }}
            >
              {stream.text || (
                <div className="flex gap-1.5 py-1">
                  <span
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{ background: T.orange }}
                  />
                  <span
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{ background: T.orange, animationDelay: "0.15s" }}
                  />
                  <span
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{ background: T.orange, animationDelay: "0.3s" }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Composer ─────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0"
        style={{
          padding: "12px 20px 16px",
          borderTop: `1px solid ${T.border}`,
        }}
      >
        <div className="flex items-center gap-2">
          {/* Mic button */}
          <button
            className="flex items-center justify-center rounded-lg border cursor-pointer transition-colors duration-150"
            style={{
              width: 40,
              height: 40,
              background: T.card,
              borderColor: T.border,
              color: T.textMuted,
            }}
          >
            <Mic size={16} />
          </button>

          {/* Text input */}
          <div className="relative flex-1">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask Iron anything..."
              disabled={isStreaming}
              className="w-full rounded-lg text-[13px] outline-none disabled:opacity-60"
              style={{
                padding: "10px 14px",
                background: T.card,
                border: `1px solid ${T.border}`,
                color: T.text,
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Send button */}
          <button
            onClick={() => handleSend()}
            disabled={isStreaming || !input.trim()}
            className="flex items-center justify-center rounded-lg border cursor-pointer transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              width: 40,
              height: 40,
              background: input.trim() ? T.orange : "transparent",
              borderColor: input.trim() ? T.orange : T.border,
              color: input.trim() ? "#fff" : T.textMuted,
            }}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
