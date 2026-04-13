import { useState, useRef, useEffect, useCallback } from "react";
import { X, Zap, ArrowRight, Info, AlertCircle } from "lucide-react";
import {
  useIronKnowledgeStream,
  type IronKnowledgeSource,
} from "../../../lib/iron/useIronKnowledgeStream";
import type { AiMessage } from "../lib/types";

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

  const suggestedPrompts = [
    "What oil filter fits a Barko 495ML?",
    "Hydraulic fluid capacity for ASV RT-75?",
    "Cross-reference NAPA 1515 to OEM",
    "Torque spec for track tensioner bolts?",
  ];

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
      className="flex flex-col h-full bg-white flex-shrink-0"
      style={{
        width: 360,
        borderLeft: "1px solid #E2E8F0",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #E2E8F0",
        }}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[#FFF3E8]">
            <Zap size={14} className="text-qep-orange" />
          </div>
          <span className="text-[13px] font-bold text-[#2D3748]">
            Parts AI
          </span>
          {stream.meta?.degradation_state === "reduced" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] font-semibold">
              Reduced
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onClose}
            className="border-none bg-transparent cursor-pointer p-1"
          >
            <X size={16} className="text-[#718096]" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto flex flex-col gap-3 p-4"
      >
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col gap-3 mt-4">
            <p className="text-[13px] text-[#718096] text-center">
              Ask about parts, specs, maintenance, or cross-references.
            </p>
            <div className="flex flex-col gap-2">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="text-left px-3 py-2 rounded-lg border border-[#E2E8F0] bg-white text-[13px] text-[#4A5568] cursor-pointer hover:bg-[#F7F8FA] hover:border-[#E87722] transition-all duration-150"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`max-w-[90%] ${msg.role === "user" ? "self-end" : "self-start"}`}
          >
            <div
              className="rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap"
              style={{
                padding: "10px 14px",
                background: msg.role === "user" ? "#E87722" : "#F7F8FA",
                color: msg.role === "user" ? "white" : "#2D3748",
                border:
                  msg.role === "assistant" ? "1px solid #E2E8F0" : "none",
              }}
            >
              {msg.content}
            </div>
            {msg.citations && msg.citations.length > 0 &&
              msg.citations.map((cite, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 mt-1 px-2 text-[11px] text-[#718096]"
                >
                  <Info size={10} />
                  {cite.title}
                  {cite.page_number ? `, pg ${cite.page_number}` : ""}
                </div>
              ))}
          </div>
        ))}

        {/* Live streaming bubble */}
        {isStreaming && (
          <div className="self-start max-w-[90%]">
            <div
              className="rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap"
              style={{
                padding: "10px 14px",
                background: "#F7F8FA",
                color: "#2D3748",
                border: "1px solid #E2E8F0",
              }}
            >
              {stream.text || (
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#718096] animate-bounce" />
                  <span
                    className="w-2 h-2 rounded-full bg-[#718096] animate-bounce"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className="w-2 h-2 rounded-full bg-[#718096] animate-bounce"
                    style={{ animationDelay: "0.3s" }}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div
        className="flex-shrink-0"
        style={{
          padding: 12,
          borderTop: "1px solid #E2E8F0",
        }}
      >
        <div className="relative">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about this machine..."
            disabled={isStreaming}
            className="w-full rounded-lg border border-[#E2E8F0] text-[13px] outline-none disabled:opacity-60"
            style={{
              padding: "10px 40px 10px 14px",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={isStreaming || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 border-none rounded-md px-2 py-1 cursor-pointer flex bg-qep-orange disabled:opacity-40"
          >
            <ArrowRight size={14} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
