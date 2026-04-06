import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface AskIronAdvisorButtonProps {
  contextType: string;
  contextId?: string;
  /** Floating bottom-right pill (default) or inline button. */
  variant?: "floating" | "inline";
  className?: string;
}

/**
 * Universal "Ask Iron Advisor" entrypoint. Drops onto every record screen
 * (Asset 360, Deal, Quote, Service Job, Parts Order, Voice Capture,
 * Customer). Routes to /chat with context_type + context_id query params
 * which the chat edge function uses to preload record state into the
 * system prompt.
 */
export function AskIronAdvisorButton({
  contextType, contextId, variant = "floating", className = "",
}: AskIronAdvisorButtonProps) {
  const href = contextId
    ? `/chat?context_type=${encodeURIComponent(contextType)}&context_id=${encodeURIComponent(contextId)}`
    : `/chat?context_type=${encodeURIComponent(contextType)}`;

  if (variant === "inline") {
    return (
      <Button asChild size="sm" variant="outline" className={className}>
        <Link to={href}>
          <Sparkles className="mr-1 h-3 w-3" aria-hidden />
          Ask Iron Advisor
        </Link>
      </Button>
    );
  }

  return (
    <Button
      asChild
      size="sm"
      className={`fixed bottom-6 right-6 z-40 h-11 rounded-full bg-qep-orange shadow-lg hover:bg-qep-orange/90 ${className}`}
    >
      <Link to={href} aria-label="Ask Iron Advisor about this record">
        <Sparkles className="mr-1 h-4 w-4" aria-hidden />
        Ask Iron Advisor
      </Link>
    </Button>
  );
}
