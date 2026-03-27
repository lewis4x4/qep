import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronUp,
  FileText,
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
}

export function ChatMessage({
  message,
  userInitials,
  streaming,
  onFeedback,
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
                : "bg-card border border-border text-foreground rounded-tl-sm"
            )}
          >
            {isThinking ? (
              <span className="flex items-center gap-2 text-muted-foreground text-xs">
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
                QEP Assistant is thinking…
              </span>
            ) : message.role === "assistant" ? (
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-code:text-qep-orange prose-code:bg-qep-orange/10 prose-code:px-1 prose-code:rounded prose-pre:bg-muted prose-pre:text-foreground prose-blockquote:border-l-qep-orange prose-a:text-qep-orange">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            ) : (
              message.content
            )}
          </div>

          {/* Copy button — hover top-right on assistant messages */}
          {message.role === "assistant" && message.content && (
            <button
              onClick={handleCopy}
              aria-label="Copy response"
              className={cn(
                "absolute -top-2 -right-2 w-7 h-7 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-all duration-150",
                "opacity-0 group-hover:opacity-100"
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
                className="flex items-center gap-1.5 text-xs text-qep-gray hover:text-foreground transition-colors duration-150 px-1"
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
                <div className="mt-1 rounded-lg border border-border bg-card px-3 py-2 space-y-1.5">
                  {message.sources.map((src, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs truncate text-foreground">
                          {src.title}
                        </span>
                      </div>
                      <span className="text-xs text-qep-gray whitespace-nowrap shrink-0">
                        {src.confidence}% match
                      </span>
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
                  "w-5 h-5 flex items-center justify-center rounded transition-colors duration-150",
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
                  "w-5 h-5 flex items-center justify-center rounded transition-colors duration-150",
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
  const diffMs = Date.now() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}
