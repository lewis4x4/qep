import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useIronStore } from "@/lib/iron/store";
import type { IronContextSurface } from "@/lib/iron/types";

interface AskIronAdvisorButtonProps {
  contextType: string;
  contextId?: string;
  contextTitle?: string;
  draftPrompt?: string;
  evidence?: string;
  replaceActiveContext?: boolean;
  preferredSurface?: IronContextSurface;
  onBeforeOpen?: () => void;
  /** Floating bottom-right pill (default) or inline button. */
  variant?: "floating" | "inline";
  className?: string;
  label?: string;
}

/**
 * Universal "Ask Iron Advisor" entrypoint. Drops onto every record screen
 * (Asset 360, Deal, Quote, Service Job, Parts Order, Voice Capture,
 * Customer). Routes to /chat with context_type + context_id query params
 * which the chat edge function uses to preload record state into the
 * system prompt.
 */
export function AskIronAdvisorButton({
  contextType,
  contextId,
  contextTitle,
  draftPrompt,
  evidence,
  replaceActiveContext = true,
  preferredSurface = "sheet",
  onBeforeOpen,
  variant = "floating",
  className = "",
  label = "Ask Iron Advisor",
}: AskIronAdvisorButtonProps) {
  const location = useLocation();
  const { openContextualAssistant } = useIronStore();

  function titleize(text: string): string {
    return text
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function defaultTitle() {
    if (contextTitle) return contextTitle;
    if (contextType === "metric" && contextId) return titleize(contextId);
    if (contextId) return `${titleize(contextType)} ${contextId}`;
    return titleize(contextType);
  }

  function defaultPrompt(title: string) {
    if (draftPrompt) return draftPrompt;
    if (contextType === "metric") {
      return `Explain ${title} for me right now. What is driving it, what changed, and what should I do next?`;
    }
    return `I’m working in ${title}. Walk me through what matters here right now, what I should notice, and what to do next.`;
  }

  function openChat() {
    const title = defaultTitle();
    onBeforeOpen?.();
    openContextualAssistant({
      kind: contextType,
      entityId: contextId ?? null,
      title,
      route: location.pathname,
      draftPrompt: defaultPrompt(title),
      evidence,
      replaceActiveContext,
      preferredSurface,
    });
  }

  if (variant === "inline") {
    return (
      <Button type="button" size="sm" variant="outline" className={className} onClick={openChat}>
        <Sparkles className="mr-1 h-3 w-3" aria-hidden />
        {label}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      type="button"
      onClick={openChat}
      className={`fixed bottom-6 right-6 z-40 h-11 rounded-full bg-qep-orange shadow-lg hover:bg-qep-orange/90 ${className}`}
    >
      <Sparkles className="mr-1 h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}
