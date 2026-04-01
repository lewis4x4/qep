import { BRAND_NAME, BrandLogo } from "@/components/BrandLogo";

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
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/80 p-2 ring-1 ring-border">
        <BrandLogo className="h-full w-full max-h-12 object-contain" decorative />
      </div>
      <div>
        <p className="font-semibold text-foreground">{BRAND_NAME} Assistant</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Ask me anything about equipment, policies, and procedures
        </p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center max-w-lg mt-1">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSuggestionClick(suggestion)}
            className="rounded-full border border-white/14 bg-gradient-to-b from-white/[0.12] to-white/[0.03] px-4 py-2 min-h-[44px] text-sm text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18)] backdrop-blur-md transition-all duration-150 hover:border-qep-orange/55 hover:from-qep-orange/20 hover:to-qep-orange/5 hover:text-qep-orange dark:border-white/12 dark:from-white/[0.08] dark:to-white/[0.02]"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
