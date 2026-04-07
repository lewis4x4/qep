import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, Send, History, Plus, ChevronDown, Shield, Download } from "lucide-react";
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
  excerpt?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  sources?: Source[];
  feedback?: "up" | "down";
  isError?: boolean;
}

interface ConversationSession {
  id: string;
  title: string;
  messageCount: number;
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

const db = supabase;

async function dbCreateConversation(title: string, context?: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await db
    .from("chat_conversations")
    .insert({ title, context: context ?? null })
    .select("id")
    .single();
  if (error) {
    console.error("[chat] Failed to create conversation:", error.message);
    return null;
  }
  return data?.id ?? null;
}

async function dbSaveMessage(
  conversationId: string,
  msg: { role: string; content: string; sources?: Source[]; traceId?: string; retrievalMeta?: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.from("chat_messages").insert({
    conversation_id: conversationId,
    role: msg.role,
    content: msg.content,
    sources: msg.sources ? JSON.parse(JSON.stringify(msg.sources)) : null,
    trace_id: msg.traceId ?? null,
    retrieval_meta: msg.retrievalMeta ?? null,
  });
  if (error) console.error("[chat] Failed to save message:", error.message);
}

async function dbUpdateConversationTitle(id: string, title: string): Promise<void> {
  await db.from("chat_conversations").update({ title }).eq("id", id);
}

async function dbSaveFeedback(conversationId: string, messageContent: string, feedback: "up" | "down"): Promise<void> {
  const { data } = await db
    .from("chat_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("content", messageContent)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id) {
    await db.from("chat_messages").update({ feedback }).eq("id", data.id);
  }
}

async function dbLoadHistory(): Promise<ConversationSession[]> {
  const { data } = await db
    .from("chat_conversations")
    .select("id, title, created_at, chat_messages(count)")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (!data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    messageCount: Array.isArray(row.chat_messages) && row.chat_messages[0]
      ? (row.chat_messages[0] as { count: number }).count
      : 0,
    createdAt: new Date(row.created_at as string),
  }));
}

async function dbLoadConversationMessages(conversationId: string): Promise<Message[]> {
  const { data } = await db
    .from("chat_messages")
    .select("id, role, content, sources, feedback, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (!data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    role: row.role as "user" | "assistant",
    content: row.content as string,
    timestamp: new Date(row.created_at as string),
    sources: (row.sources as Source[] | null) ?? undefined,
    feedback: (row.feedback as "up" | "down" | null) ?? undefined,
  }));
}

export function ChatPage({ userRole, userEmail }: ChatPageProps) {
  const location = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [history, setHistory] = useState<ConversationSession[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatDiagnostics, setChatDiagnostics] = useState<{
    traceId: string;
    embeddingDegraded: boolean;
    documentEvidenceCount: number;
    crmEvidenceCount: number;
    emptyEvidence: boolean;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>(messages);
  const chatMountedRef = useRef(true);
  const chatAbortRef = useRef<AbortController | null>(null);
  const initialQueryFiredRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatMountedRef.current = true;
    dbLoadHistory().then((h) => {
      if (chatMountedRef.current) setHistory(h);
    }).catch(() => {});
    return () => {
      chatMountedRef.current = false;
      chatAbortRef.current?.abort();
    };
  }, []);
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const chatContext = useMemo(
    () => {
      // AskIronAdvisorButton uses context_type / context_id query params.
      // Map them onto the existing context shape so the chat fn picks them up.
      const ctxType = searchParams.get("context_type");
      const ctxId = searchParams.get("context_id");
      const fromAskAdvisor: Record<string, string> = {};
      if (ctxId) {
        if (ctxType === "company") fromAskAdvisor.companyId = ctxId;
        else if (ctxType === "contact") fromAskAdvisor.contactId = ctxId;
        else if (ctxType === "deal") fromAskAdvisor.dealId = ctxId;
        else if (ctxType === "equipment") fromAskAdvisor.equipmentId = ctxId;
        else if (ctxType === "service_job") fromAskAdvisor.serviceJobId = ctxId;
        else if (ctxType === "parts_order") fromAskAdvisor.partsOrderId = ctxId;
        else if (ctxType === "voice_capture") fromAskAdvisor.voiceCaptureId = ctxId;
        else if (ctxType === "flare") fromAskAdvisor.flareReportId = ctxId;
        else if (ctxType === "metric") fromAskAdvisor.metricKey = ctxId;
        else if (ctxType === "flow_run") fromAskAdvisor.flowRunId = ctxId;
      }
      return {
        customerProfileId: searchParams.get("customer_profile_id") || undefined,
        contactId: searchParams.get("contact_id") || fromAskAdvisor.contactId || undefined,
        companyId: searchParams.get("company_id") || fromAskAdvisor.companyId || undefined,
        dealId: searchParams.get("deal_id") || fromAskAdvisor.dealId || undefined,
        equipmentId: fromAskAdvisor.equipmentId,
        serviceJobId: fromAskAdvisor.serviceJobId,
        partsOrderId: fromAskAdvisor.partsOrderId,
        voiceCaptureId: fromAskAdvisor.voiceCaptureId,
        flareReportId: fromAskAdvisor.flareReportId,
        metricKey: fromAskAdvisor.metricKey,
        flowRunId: fromAskAdvisor.flowRunId,
      };
    },
    [searchParams]
  );
  const hasChatContext = Boolean(
    chatContext.customerProfileId || chatContext.contactId || chatContext.companyId || chatContext.dealId
    || chatContext.equipmentId || chatContext.serviceJobId || chatContext.partsOrderId || chatContext.voiceCaptureId
    || chatContext.flareReportId || chatContext.metricKey || chatContext.flowRunId
  );
  const contextLabel = useMemo(() => {
    if (chatContext.flowRunId) return "Flow run context active: the workflow definition, full step trace, resolved context, originating event, and any dead-letter detail are preloaded.";
    if (chatContext.metricKey) return `Command Center metric context active (${chatContext.metricKey}): the latest snapshot, snapshot history, and any open alerts on this KPI are preloaded.`;
    if (chatContext.flareReportId) return "Flare report context active: answers can use the captured bug context, click trail, and console errors.";
    if (chatContext.equipmentId) return "Asset context active: answers can use this equipment's full history + matching service KB.";
    if (chatContext.serviceJobId) return "Service job context active.";
    if (chatContext.partsOrderId) return "Parts order context active.";
    if (chatContext.voiceCaptureId) return "Voice capture context active.";
    if (chatContext.dealId) return "Customer context active: answers can use this deal's QRM and sales history.";
    if (chatContext.contactId) return "Customer context active: answers can use this contact's QRM and sales history.";
    if (chatContext.companyId) return "Customer context active: answers can use this company's QRM and sales history.";
    if (chatContext.customerProfileId) return "Customer context active: answers can use linked customer profile history.";
    return null;
  }, [chatContext]);

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 120;
  }, []);

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

  const refreshHistory = useCallback(() => {
    dbLoadHistory().then((h) => {
      if (chatMountedRef.current) setHistory(h);
    }).catch(() => {});
  }, []);

  function startNewChat() {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    conversationIdRef.current = null;
    userScrolledUpRef.current = false;
    setMessages([]);
    setInput("");
    setStreaming(false);
    setChatDiagnostics(null);
    setHistoryOpen(false);
    refreshHistory();
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function exportConversation() {
    if (messages.length === 0) return;
    const lines: string[] = [
      "# QEP Knowledge Chat Export",
      `*Exported: ${new Date().toLocaleString()}*`,
      "",
    ];
    for (const msg of messages) {
      const role = msg.role === "user" ? "**You**" : "**QEP Assistant**";
      const time = msg.timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      lines.push(`### ${role} — ${time}`);
      lines.push("");
      lines.push(msg.content);
      lines.push("");
    }

    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qep-chat-${new Date().toISOString().split("T")[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadSession(session: ConversationSession) {
    chatAbortRef.current?.abort();
    conversationIdRef.current = session.id;
    const loaded = await dbLoadConversationMessages(session.id);
    if (chatMountedRef.current) {
      setMessages(loaded);
      setHistoryOpen(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
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

    userScrolledUpRef.current = false;
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setChatDiagnostics(null);
    setStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", timestamp: new Date() },
    ]);

    // Create conversation in DB if this is the first message
    if (!conversationIdRef.current) {
      const ctx = hasChatContext ? chatContext : undefined;
      const convId = await dbCreateConversation(autoTitle([userMessage]), ctx as Record<string, unknown> | undefined);
      conversationIdRef.current = convId;
    }

    // Persist user message in background
    if (conversationIdRef.current) {
      dbSaveMessage(conversationIdRef.current, { role: "user", content }).catch(() => {});
    }

    chatAbortRef.current?.abort();
    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    const { signal } = abortController;

    let lastTraceId: string | undefined;
    let lastRetrievalMeta: Record<string, unknown> | undefined;
    let assistantSources: Source[] | undefined;

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

        const legacyRateLimitCheckBody =
          message.trim() === "Chat is temporarily unavailable. Please try again shortly.";

        if (code === "AUTH_REQUIRED") {
          message = "Your session expired. Sign in again and retry.";
        } else if (code === "RATE_LIMITED") {
          message = "You are sending messages too quickly. Please wait a minute and try again.";
        } else if (code === "RATE_LIMIT_CHECK_FAILED" || legacyRateLimitCheckBody) {
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
              lastTraceId = parsed.meta.trace_id;
              lastRetrievalMeta = parsed.meta.retrieval as Record<string, unknown> | undefined;
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
              assistantSources = parsed.sources;
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

      // Persist completed assistant message to DB
      if (conversationIdRef.current) {
        const finalMsg = messagesRef.current.find((m) => m.id === assistantId);
        if (finalMsg?.content) {
          dbSaveMessage(conversationIdRef.current, {
            role: "assistant",
            content: finalMsg.content,
            sources: assistantSources,
            traceId: lastTraceId,
            retrievalMeta: lastRetrievalMeta,
          }).catch(() => {});

          // Update conversation title to first user message
          if (messagesRef.current.filter((m) => m.role === "user").length <= 1) {
            dbUpdateConversationTitle(conversationIdRef.current, autoTitle(messagesRef.current)).catch(() => {});
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
                  isError: true,
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
        refreshHistory();
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function handleFeedback(id: string, feedback: "up" | "down") {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, feedback } : m))
    );
    // Persist feedback to DB
    if (conversationIdRef.current) {
      const msg = messagesRef.current.find((m) => m.id === id);
      if (msg?.content) {
        dbSaveFeedback(conversationIdRef.current, msg.content, feedback).catch(() => {});
      }
    }
  }

  function handleSuggestion(text: string) {
    void sendMessage(text);
  }

  const userInitials = getInitials(userEmail);

  return (
    <div className="flex flex-col h-[calc(100dvh-7.5rem)] lg:h-[calc(100dvh-3.5rem)]">
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
                          onClick={() => loadSession(session).catch(() => {})}
                          className="w-full text-left px-3 py-2.5 hover:bg-muted transition-colors duration-100 group"
                        >
                          <p className="text-sm text-foreground truncate">{session.title}</p>
                          <p className="text-xs text-qep-gray mt-0.5">
                            {session.createdAt.toLocaleDateString()} ·{" "}
                            {session.messageCount} messages
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Export */}
          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={exportConversation}
              className="gap-1.5"
              aria-label="Export conversation"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}

          {/* New chat */}
          <Button
            variant="outline"
            size="sm"
            onClick={startNewChat}
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
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        {messages.length === 0 ? (
          <ChatEmptyState userRole={userRole} onSuggestionClick={handleSuggestion} />
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((message, idx) => (
              <ChatMessage
                key={message.id}
                message={message}
                userInitials={userInitials}
                streaming={streaming}
                onFeedback={handleFeedback}
                onRetry={message.isError ? () => {
                  const lastUserMsg = messages.slice(0, idx).reverse().find(m => m.role === "user");
                  if (lastUserMsg) {
                    setMessages(prev => prev.filter(m => m.id !== message.id));
                    void sendMessage(lastUserMsg.content);
                  }
                } : undefined}
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
            onClick={() => void sendMessage()}
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
