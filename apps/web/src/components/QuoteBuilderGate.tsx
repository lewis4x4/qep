import { HardHat, Lock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QuoteBuilderGate(): React.ReactElement {
  return (
    <div
      role="main"
      aria-labelledby="qb-gate-heading"
      className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-6 py-16 text-center"
    >
      {/* Hard hat icon */}
      <div
        className="w-24 h-24 rounded-full bg-qep-orange-light flex items-center justify-center mb-6"
        aria-hidden="true"
      >
        <HardHat className="w-12 h-12 text-qep-orange" />
      </div>

      {/* Lock badge */}
      <div
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-qep-orange-light text-qep-orange-hover text-xs font-semibold mb-4"
        aria-hidden="true"
      >
        <Lock className="w-3 h-3" />
        Coming Soon
      </div>

      {/* Heading */}
      <h1
        id="qb-gate-heading"
        className="text-2xl font-bold text-foreground mb-3"
      >
        Quote Builder
      </h1>

      {/* Description */}
      <p className="text-muted-foreground max-w-sm mb-2 leading-relaxed">
        Quote Builder requires a live connection to your IntelliDealer inventory
        system.
      </p>
      <p className="text-muted-foreground max-w-sm mb-8 leading-relaxed">
        Ask your administrator to connect IntelliDealer in the Admin settings to
        unlock equipment catalog, pricing, and proposal generation.
      </p>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <a
          href="https://www.intellidealer.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium text-qep-orange-hover hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-qep-orange focus-visible:outline-offset-2 rounded"
          aria-label="Learn more about IntelliDealer integration (opens in new tab)"
        >
          Learn More
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
