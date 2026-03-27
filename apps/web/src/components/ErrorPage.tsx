import { HardHat, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorPageProps {
  onRetry?: () => void;
}

export function ErrorPage({ onRetry }: ErrorPageProps): React.ReactElement {
  function handleRetry() {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  }

  return (
    <div
      role="main"
      aria-labelledby="error-page-heading"
      className="flex flex-col items-center justify-center min-h-screen px-6 py-16 text-center bg-background"
    >
      {/* Hard hat icon */}
      <div
        className="w-24 h-24 rounded-full bg-qep-orange-light flex items-center justify-center mb-6"
        aria-hidden="true"
      >
        <HardHat className="w-12 h-12 text-qep-orange" />
      </div>

      {/* 500 label */}
      <p className="text-sm font-semibold text-qep-orange-hover mb-2 tracking-widest uppercase">
        500 — Server Error
      </p>

      {/* Heading */}
      <h1
        id="error-page-heading"
        className="text-3xl font-bold text-foreground mb-3"
      >
        Something went wrong
      </h1>

      {/* Description */}
      <p className="text-muted-foreground max-w-sm mb-8 leading-relaxed">
        We ran into an unexpected error. This has been logged and we're looking
        into it. Try refreshing to get back to work.
      </p>

      {/* Action */}
      <Button
        size="lg"
        onClick={handleRetry}
        className="min-w-[160px] min-h-[44px]"
      >
        <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
        Try Again
      </Button>
    </div>
  );
}
