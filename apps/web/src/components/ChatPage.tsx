import { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Send, History, Plus, ChevronDown } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserRole } from "../lib/database.types";
import { ChatEmptyState } from "./ChatEmptyState";
import { ChatMessage } from "./ChatMessage";

export interface Source {
  title: string;
  confidence: number;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);
  const initialQueryFiredRef = useRef(false);

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
    setStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", timestamp: new Date() },
    ]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const msgHistory = messages
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ message: content, history: msgHistory }),
        }
      );

      if (!response.ok || !response.body) {
        throw new Error("Chat request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as { text?: string; sources?: Source[] };
            if (parsed.text) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + parsed.text }
                    : m
                )
              );
            }
            if (parsed.sources) {
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
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Couldn't get a response. Check your connection and try again." }
            : m
        )
      );
    } finally {
      setStreaming(false);
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
            Ask questions about QEP equipment and processes
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
            placeholder="Ask about QEP equipment, policies, or procedures…"
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
        </p>
      </div>
    </div>
  );
}
