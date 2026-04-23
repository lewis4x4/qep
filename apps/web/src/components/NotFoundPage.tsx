import { Link } from "react-router-dom";
import { HardHat, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NotFoundPage(): React.ReactElement {
  return (
    <div
      role="main"
      aria-labelledby="not-found-heading"
      className="flex flex-col items-center justify-center min-h-screen px-6 py-16 text-center bg-background"
    >
      {/* Hard hat icon */}
      <div
        className="w-24 h-24 rounded-full bg-qep-orange-light flex items-center justify-center mb-6"
        aria-hidden="true"
      >
        <HardHat className="w-12 h-12 text-qep-orange" />
      </div>

      {/* 404 label */}
      <p className="text-sm font-semibold text-qep-orange-hover mb-2 tracking-widest uppercase">
        404 — Page Not Found
      </p>

      {/* Heading */}
      <h1
        id="not-found-heading"
        className="text-3xl font-bold text-foreground mb-3"
      >
        We can't find that page
      </h1>

      {/* Description */}
      <p className="text-muted-foreground max-w-sm mb-8 leading-relaxed">
        The page you're looking for doesn't exist or may have been moved. Head
        back to your dashboard to get back on track.
      </p>

      {/* Action */}
      <Button asChild size="lg" className="min-w-[160px] min-h-[44px]">
        <Link to="/dashboard">
          <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
          Back to Dashboard
        </Link>
      </Button>
    </div>
  );
}

export default NotFoundPage;
