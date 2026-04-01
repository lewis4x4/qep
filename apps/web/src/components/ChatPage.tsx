import { useMemo, useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, Send, History, Plus, ChevronDown, Shield } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserRole } from "../lib/database.types";
import { ChatEmptyState } from "./ChatEmptyState";
import { ChatMessage } from "./ChatMessage";

export interface Source {
  id: string;
  title: string;
  confidence: number;
  kind: "document" | "crm";
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  sources?: Source[];
  feedback?: "up" | "down";
}

interface ConversationSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

interface ChatPageProps {
  userRole: UserRole;
  userEmail: string | null;
}

function getInitials(email: string | null): string {
  if (!email) return "U";
  return email[0].toUpperCase();
}

function autoTitle(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "Conversation";
  return first.content.slice(0, 40) + (first.content.length > 40 ? "…" : "");
}

const STORAGE_KEY_HISTORY = "qep-chat-history";
const STORAGE_KEY_CURRENT = "qep-chat-current";
const MAX_STORED_CONVERSATIONS = 50;
const MAX_STORAGE_BYTES = 4 * 1024 * 1024; // 4MB — well below the ~5-10MB browser limit

function saveHistory(convos: ConversationSession[]): void {
  let trimmed = convos.slice(0, MAX_STORED_CONVERSATIONS);
  let json = JSON.stringify(trimmed);
  // Drop oldest conversations until under the byte limit
  while (json.length > MAX_STORAGE_BYTES && trimmed.length > 0) {
    trimmed = trimmed.slice(0, -1);
    json = JSON.stringify(trimmed);
  }
  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, json);
  } catch {
    // QuotaExceededError — clear rather than silently fail
    localStorage.removeItem(STORAGE_KEY_HISTORY);
  }
}

function reviveMessages(raw: unknown[]): Message[] {
  return raw.map((m) => {
    const msg = m as Record<string, unknown>;
    return { ...msg, timestamp: new Date(msg.timestamp as string) } as Message;
  });
}

function loadHistory(): ConversationSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return parsed.map((s) => ({
      ...s,
      createdAt: new Date(s.createdAt as string),
      messages: reviveMessages(s.messages as unknown[]),
    })) as ConversationSession[];
  } catch {
    return [];
  }
}

function loadCurrentMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CURRENT);
    if (!raw) return [];
    return reviveMessages(JSON.parse(raw) as unknown[]);
  } catch {
    return [];
  }
}

export function ChatPage({ userEmail }: ChatPageProps) {
  const location = useLocation();
  const [messages, setMessages] = useState<Message[]>(() => loadCurrentMessages());
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [history, setHistory] = useState<ConversationSession[]>(() => loadHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Last successful stream diagnostics from the chat edge function (trace + retrieval). */
  const [chatDiagnostics, setChatDiagnostics] = useState<{
    traceId: string;
    embeddingDegraded: boolean;
    documentEvidenceCount: number;
    crmEvidenceCount: number;
    emptyEvidence: boolean;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>(messages);
  const chatMountedRef = useRef(true);
  const chatAbortRef = useRef<AbortController | null>(null);
  const initialQueryFiredRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatMountedRef.current = true;
    return () => {
      chatMountedRef.current = false;
      chatAbortRef.current?.abort();
    };
  }, []);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const chatContext = useMemo(
    () => ({
      customerProfileId: searchParams.get("customer_profile_id") || undefined,
      contactId: searchParams.get("contact_id") || undefined,
      companyId: searchParams.get("company_id") || undefined,
      dealId: searchParams.get("deal_id") || undefined,
    }),
    [searchParams]
  );
  const hasChatContext = Boolean(
    chatContext.customerProfileId || chatContext.contactId || chatContext.companyId || chatContext.dealId
  );
  const contextLabel = useMemo(() => {
    if (chatContext.dealId) return "Customer context active: answers can use this deal's CRM and sales history.";
    if (chatContext.contactId) return "Customer context active: answers can use this contact's CRM and sales history.";
    if (chatContext.companyId) return "Customer context active: answers can use this company's CRM and sales history.";
    if (chatContext.customerProfileId) return "Customer context active: answers can use linked customer profile history.";
    return null;
  }, [chatContext]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Persist current messages and history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CURRENT, JSON.stringify(messages));
    } catch {
      localStorage.removeItem(STORAGE_KEY_CURRENT);
    }
  }, [messages]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // Handle global search handoff: initialQuery from TopBar
  useEffect(() => {
    const state = location.state as { initialQuery?: string } | null;
    if (state?.initialQuery && typeof state.initialQuery === "string" && !initialQueryFiredRef.current) {
      initialQueryFiredRef.current = true;
      window.history.replaceState({}, "");
      void sendMessage(state.initialQuery);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle "New Chat" trigger from TopBar (same-route navigation)
  const lastNewChatRef = useRef<number | null>(null);
  useEffect(() => {
    const state = location.state as { newChat?: number } | null;
    const ts = state?.newChat;
    if (ts && ts !== lastNewChatRef.current) {
      lastNewChatRef.current = ts;
      window.history.replaceState({}, "");
      startNewChat();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Close history panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        historyOpen &&
        historyPanelRef.current &&
        !historyPanelRef.current.contains(e.target as Node)
      ) {
        setHistoryOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [historyOpen]);

  function startNewChat() {
    chatAbortRef.current?.abort();
    if (messages.length > 0) {
      const session: ConversationSession = {
        id: crypto.randomUUID(),
        title: autoTitle(messages),
        messages,
        createdAt: new Date(),
      };
      setHistory((prev) => [session, ...prev]);
    }
    setMessages([]);
    setInput("");
    setHistoryOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function loadSession(session: ConversationSession) {
    chatAbortRef.current?.abort();
    // Save current conversation if it has messages
    if (messages.length > 0) {
      const current: ConversationSession = {
        id: crypto.randomUUID(),
        title: autoTitle(messages),
        messages,
        createdAt: new Date(),
      };
      setHistory((prev) => [current, ...prev.filter((s) => s.id !== session.id)]);
    } else {
      setHistory((prev) => prev.filter((s) => s.id !== session.id));
    }
    setMessages(session.messages);
    setHistoryOpen(false);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim();
    if (!content || streaming) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setChatDiagnostics(null);
    setStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", timestamp: new Date() },
    ]);

    chatAbortRef.current?.abort();
    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    const { signal } = abortController;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const msgHistory = messagesRef.current
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          message: content,
          history: msgHistory,
          context: hasChatContext ? chatContext : undefined,
        }),
        signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string; code?: string; trace_id?: string } }
          | null;
        const code = payload?.error?.code;
        const traceId = payload?.error?.trace_id;
        let message = payload?.error?.message ?? "Chat request failed.";

        // Old chat edge returns this exact body for RATE_LIMIT_CHECK_FAILED; some proxies strip `code`.
        const legacyRateLimitCheckBody =
          message.trim() === "Chat is temporarily unavailable. Please try again shortly.";

        if (code === "AUTH_REQUIRED") {
          message = "Your session expired. Sign in again and retry.";
        } else if (code === "RATE_LIMITED") {
          message = "You are sending messages too quickly. Please wait a minute and try again.";
        } else if (code === "RATE_LIMIT_CHECK_FAILED" || legacyRateLimitCheckBody) {
          // Legacy edge: 503 when check_rate_limit RPC failed (no table fallback). Fix = deploy current chat function.
          message =
            "Chat could not verify usage limits. Please try again in a minute. If this keeps happening, the chat service needs redeploying.";
        } else if (code === "EMBEDDING_FAILED") {
          message = "The embedding service is temporarily unavailable.";
        } else if (code === "DOCUMENT_RETRIEVAL_FAILED") {
          message = "Knowledge search is temporarily unavailable.";
        } else if (code === "CRM_CONTEXT_RETRIEVAL_FAILED") {
          message = "Customer context could not be loaded for this chat.";
        } else if (code === "MODEL_UNAVAILABLE") {
          message = "The chat model is temporarily unavailable.";
        } else if (code === "INVALID_REQUEST" || code === "INVALID_MESSAGE") {
          message = payload?.error?.message ?? "The request could not be processed.";
        } else if (code === "CHAT_INTERNAL_ERROR") {
          message = "Chat encountered an unexpected error.";
        }

        if (traceId) {
          message = `${message} Reference: ${traceId}`;
        }

        throw new Error(message);
      }

      if (!response.body) {
        throw new Error("Chat stream was unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (signal.aborted) break;
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as {
              text?: string;
              sources?: Source[];
              meta?: {
                trace_id?: string;
                retrieval?: {
                  embedding_degraded?: boolean;
                  document_evidence_count?: number;
                  crm_evidence_count?: number;
                  empty_evidence?: boolean;
                };
              };
            };
            if (parsed.meta?.trace_id) {
              const r = parsed.meta.retrieval;
              if (chatMountedRef.current) {
                setChatDiagnostics({
                  traceId: parsed.meta.trace_id,
                  embeddingDegraded: Boolean(r?.embedding_degraded),
                  documentEvidenceCount: typeof r?.document_evidence_count === "number"
                    ? r.document_evidence_count
                    : 0,
                  crmEvidenceCount: typeof r?.crm_evidence_count === "number" ? r.crm_evidence_count : 0,
                  emptyEvidence: Boolean(r?.empty_evidence),
                });
              }
            }
            if (parsed.text && chatMountedRef.current) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + parsed.text }
                    : m
                )
              );
            }
            if (parsed.sources && chatMountedRef.current) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, sources: parsed.sources } : m
                )
              );
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (chatMountedRef.current) {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        }
        return;
      }
      if (chatMountedRef.current) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    error instanceof Error
                      ? error.message
                      : "Couldn't get a response. Check your connection and try again.",
                }
              : m
          )
        );
      }
    } finally {
      if (chatAbortRef.current !== abortController) {
        return;
      }
      chatAbortRef.current = null;
      if (chatMountedRef.current) {
        setStreaming(false);
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleFeedback(id: string, feedback: "up" | "down") {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, feedback } : m))
    );
  }

  // Suggestion chip click → populate input + auto-send
  function handleSuggestion(text: string) {
    sendMessage(text);
  }

  const userInitials = getInitials(userEmail);

  return (
    <div className="flex flex-col h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-3rem)]">
      {/* Page header */}
      <div className="border-b bg-card px-6 py-4 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Knowledge Chat</h1>
          <p className="text-sm text-muted-foreground">
            {hasChatContext
              ? "Ask questions grounded in your accessible documents and this customer context"
              : "Ask questions about equipment and dealership processes"}
          </p>
        </div>

        {/* History + new chat controls */}
        <div className="flex items-center gap-2" ref={historyPanelRef}>
          {/* History dropdown */}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen((v) => !v)}
              className="gap-1.5"
              aria-expanded={historyOpen}
              aria-label="Conversation history"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">History</span>
              <ChevronDown className={cn("w-3 h-3 transition-transform duration-150", historyOpen && "rotate-180")} />
            </Button>

            {historyOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-border bg-card shadow-lg z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Past conversations
                  </span>
                </div>
                {history.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                    No past conversations yet
                  </div>
                ) : (
                  <ul className="max-h-64 overflow-y-auto py-1">
                    {history.map((session) => (
                      <li key={session.id}>
                        <button
                          onClick={() => loadSession(session)}
                          className="w-full text-left px-3 py-2.5 hover:bg-muted transition-colors duration-100 group"
                        >
                          <p className="text-sm text-foreground truncate">{session.title}</p>
                          <p className="text-xs text-qep-gray mt-0.5">
                            {session.createdAt.toLocaleDateString()} ·{" "}
                            {session.messages.filter((m) => m.role === "user").length} messages
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* New chat */}
          <Button
            variant="outline"
            size="sm"
            onClick={startNewChat}
            disabled={messages.length === 0}
            className="gap-1.5"
            aria-label="New conversation"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New chat</span>
          </Button>
        </div>
      </div>

      {(contextLabel || chatDiagnostics?.embeddingDegraded) && (
        <div className="px-6 py-3 border-b bg-card/60 space-y-2">
          {contextLabel && (
            <div className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-gradient-to-b from-white/[0.1] to-white/[0.02] px-3 py-1.5 text-xs text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16)] backdrop-blur-md dark:border-white/12 dark:from-white/[0.07] dark:to-white/[0.02]">
              <Shield className="w-3.5 h-3.5 text-qep-orange" />
              {contextLabel}
            </div>
          )}
          {chatDiagnostics?.embeddingDegraded && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
              <span>
                Semantic search is unavailable; answers used keyword and text matching only. If quality is poor, retry later.
                {chatDiagnostics.traceId ? ` Reference: ${chatDiagnostics.traceId}` : ""}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <ChatEmptyState onSuggestionClick={handleSuggestion} />
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                userInitials={userInitials}
                streaming={streaming}
                onFeedback={handleFeedback}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area — sticky at bottom */}
      <div className="border-t bg-card px-4 py-3 shrink-0">
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about equipment, policies, or procedures…"
            rows={1}
            disabled={streaming}
            className={cn(
              "flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-qep-orange focus:ring-offset-1",
              "disabled:opacity-50 max-h-32 overflow-y-auto min-h-[44px]"
            )}
          />
          <Button
            onClick={() => sendMessage()}
            disabled={streaming || !input.trim()}
            size="icon"
            className={cn(
              "shrink-0 rounded-xl h-11 w-11 transition-colors duration-150",
              input.trim() && !streaming
                ? "bg-qep-orange hover:bg-qep-orange-hover text-white"
                : "bg-muted text-muted-foreground"
            )}
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          Press Enter to send · Shift+Enter for new line
          {chatDiagnostics?.traceId && !chatDiagnostics.embeddingDegraded && (
            <span className="block mt-1 font-mono text-[10px] opacity-80">
              Trace: {chatDiagnostics.traceId}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
