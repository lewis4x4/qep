import { lazy, Suspense, useState } from "react";
const ReactMarkdown = lazy(() => import("react-markdown"));
import remarkGfm from "remark-gfm";
import {
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronUp,
  FileText,
  Database,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { HardHat } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "./ChatPage";

interface ChatMessageProps {
  message: Message;
  userInitials: string;
  streaming: boolean;
  onFeedback: (id: string, feedback: "up" | "down") => void;
  onRetry?: () => void;
}

export function ChatMessage({
  message,
  userInitials,
  streaming,
  onFeedback,
  onRetry,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isThinking = message.role === "assistant" && !message.content && streaming;

  return (
    <div
      className={cn(
        "flex gap-3",
        message.role === "user" ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      {message.role === "assistant" ? (
        <Avatar className="w-8 h-8 shrink-0 mt-0.5">
          <AvatarFallback className="bg-qep-orange/10 text-qep-orange">
            <HardHat className="w-4 h-4" />
          </AvatarFallback>
        </Avatar>
      ) : (
        <Avatar className="w-8 h-8 shrink-0 mt-0.5">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
            {userInitials}
          </AvatarFallback>
        </Avatar>
      )}

      {/* Bubble + metadata */}
      <div
        className={cn(
          "flex flex-col gap-1 max-w-[75%] sm:max-w-[65%]",
          message.role === "user" ? "items-end" : "items-start"
        )}
      >
        {/* Message bubble */}
        <div className="relative group w-full">
          <div
            className={cn(
              "rounded-2xl px-4 py-3 text-sm leading-relaxed",
              message.role === "user"
                ? "bg-primary text-primary-foreground rounded-tr-sm whitespace-pre-wrap"
                : message.isError
                  ? "bg-red-500/10 border border-red-500/30 text-red-300 rounded-tl-sm"
                  : "bg-card border border-border text-foreground rounded-tl-sm"
            )}
          >
            {isThinking ? (
              <span
                className="flex items-center gap-2 text-muted-foreground text-xs"
                aria-busy="true"
                aria-live="polite"
              >
                <span className="flex gap-1">
                  <span
                    className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse"
                    style={{ animationDelay: "200ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse"
                    style={{ animationDelay: "400ms" }}
                  />
                </span>
                Assistant is thinking…
              </span>
            ) : message.isError ? (
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                  <span>{message.content}</span>
                </div>
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Retry
                  </button>
                )}
              </div>
            ) : message.role === "assistant" ? (
              <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-code:text-qep-orange prose-code:bg-qep-orange/10 prose-code:px-1 prose-code:rounded prose-pre:bg-muted prose-pre:text-foreground prose-blockquote:border-l-qep-orange prose-a:text-qep-orange">
                <Suspense fallback={<p className="text-sm text-muted-foreground">{message.content}</p>}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                </Suspense>
              </div>
            ) : (
              message.content
            )}
          </div>

          {/* Copy button — hover/focus-within top-right on assistant messages; always visible on touch */}
          {message.role === "assistant" && message.content && (
            <button
              onClick={handleCopy}
              aria-label="Copy response"
              className={cn(
                "absolute -top-3 -right-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/16 bg-gradient-to-b from-white/[0.14] to-white/[0.04] text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] backdrop-blur-md transition-all duration-150 hover:border-primary/40 hover:from-primary/15 hover:to-primary/5 hover:text-foreground dark:border-white/12 dark:from-white/[0.09] dark:to-white/[0.02]",
                "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 [@media(hover:none)]:opacity-100"
              )}
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-qep-success" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        {/* Source citations */}
        {message.role === "assistant" &&
          message.sources &&
          message.sources.length > 0 && (
            <div className="w-full">
              <button
                onClick={() => setSourcesOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-qep-gray hover:text-foreground transition-colors duration-150 px-2 min-h-[44px]"
              >
                <FileText className="w-3 h-3" />
                {message.sources.length}{" "}
                {message.sources.length === 1 ? "source" : "sources"}
                {sourcesOpen ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
              {sourcesOpen && (
                <div className="mt-1 rounded-lg border border-border bg-card px-3 py-2 space-y-2">
                  {message.sources.map((src, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          {src.kind === "crm" ? (
                            <Database className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="text-xs truncate text-foreground">
                            {src.title}
                          </span>
                          <span className="rounded-full border border-white/12 bg-gradient-to-b from-white/[0.1] to-white/[0.02] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)] backdrop-blur-sm dark:from-white/[0.07] dark:to-white/[0.02]">
                            {src.kind === "crm" ? "CRM" : "Document"}
                          </span>
                        </div>
                        <span className="text-xs text-qep-gray whitespace-nowrap shrink-0">
                          {src.confidence}% match
                        </span>
                      </div>
                      {src.excerpt && (
                        <p className="text-[11px] text-muted-foreground leading-snug pl-5.5 line-clamp-2 italic">
                          &ldquo;{src.excerpt}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        {/* Timestamp + feedback row */}
        <div
          className={cn(
            "flex items-center gap-2 px-1",
            message.role === "user" ? "flex-row-reverse" : "flex-row"
          )}
        >
          <span className="text-xs text-qep-gray">
            {formatRelativeTime(message.timestamp)}
          </span>

          {/* Thumbs feedback — assistant only, after content is done */}
          {message.role === "assistant" && message.content && !streaming && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onFeedback(message.id, "up")}
                aria-label="Helpful"
                className={cn(
                  "h-11 w-11 flex items-center justify-center rounded transition-colors duration-150",
                  message.feedback === "up"
                    ? "text-qep-success"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onFeedback(message.id, "down")}
                aria-label="Not helpful"
                className={cn(
                  "h-11 w-11 flex items-center justify-center rounded transition-colors duration-150",
                  message.feedback === "down"
                    ? "text-qep-error"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (isToday) return timeStr;
  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${dateStr} ${timeStr}`;
}
