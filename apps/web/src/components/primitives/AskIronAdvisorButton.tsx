import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface AskIronAdvisorButtonProps {
  contextType: string;
  contextId?: string;
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
  contextType, contextId, variant = "floating", className = "", label = "Ask Iron Advisor",
}: AskIronAdvisorButtonProps) {
  const navigate = useNavigate();
  const href = contextId
    ? `/chat?context_type=${encodeURIComponent(contextType)}&context_id=${encodeURIComponent(contextId)}`
    : `/chat?context_type=${encodeURIComponent(contextType)}`;
  const askIronState = {
    askIronContext: {
      contextType,
      contextId: contextId ?? null,
      href,
    },
  };

  function openChat() {
    navigate(href, { state: askIronState });
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
