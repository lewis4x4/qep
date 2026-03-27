import { HardHat } from "lucide-react";

interface ChatEmptyStateProps {
  onSuggestionClick: (text: string) => void;
}

const SUGGESTIONS = [
  "What's the PTO policy?",
  "Barko 595B specifications",
  "How do I submit a warranty claim?",
  "What financing options do we offer?",
];

export function ChatEmptyState({ onSuggestionClick }: ChatEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-4 pb-16 px-4">
      <div className="w-14 h-14 rounded-full bg-qep-orange/10 flex items-center justify-center">
        <HardHat className="w-7 h-7 text-qep-orange" />
      </div>
      <div>
        <p className="font-semibold text-foreground">QEP Assistant</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Ask me anything about QEP equipment, policies, and procedures
        </p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center max-w-lg mt-1">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSuggestionClick(suggestion)}
            className="rounded-full border border-border bg-card px-4 py-2 min-h-[44px] text-sm text-foreground hover:border-qep-orange hover:text-qep-orange transition-colors duration-150"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
