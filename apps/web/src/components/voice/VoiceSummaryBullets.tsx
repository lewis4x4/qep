import { cn } from "@/lib/utils";

interface VoiceSummaryBulletsProps {
  bullets: string[] | null | undefined;
  className?: string;
  title?: string;
  compact?: boolean;
}

function normalizeBullets(bullets: string[] | null | undefined): string[] {
  if (!Array.isArray(bullets)) return [];
  return bullets
    .map((bullet) => bullet.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function VoiceSummaryBullets({
  bullets,
  className,
  title = "Key takeaways",
  compact = false,
}: VoiceSummaryBulletsProps) {
  const normalized = normalizeBullets(bullets);
  if (normalized.length === 0) return null;

  return (
    <section
      className={cn(
        "rounded-lg border border-qep-orange/25 bg-qep-orange/10",
        compact ? "p-3" : "p-4",
        className,
      )}
    >
      <p className={cn(
        "font-semibold uppercase tracking-[0.14em] text-qep-orange",
        compact ? "text-[10px]" : "text-xs",
      )}>
        {title}
      </p>
      <ul className={cn("mt-2 list-disc space-y-1 pl-5 text-foreground", compact ? "text-xs" : "text-sm")}>
        {normalized.map((bullet, index) => (
          <li key={`${index}-${bullet}`} className="leading-5">
            {bullet}
          </li>
        ))}
      </ul>
    </section>
  );
}
