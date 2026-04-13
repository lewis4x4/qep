interface AiBriefingCardProps {
  greeting: string;
  priorityCount: number;
}

export function AiBriefingCard({ greeting, priorityCount }: AiBriefingCardProps) {
  return (
    <div className="bg-gradient-to-br from-qep-orange/5 to-qep-orange/10 border border-qep-orange/20 rounded-2xl px-5 py-4">
      <p className="text-base font-semibold text-slate-900">{greeting}</p>
      {priorityCount > 0 && (
        <p className="text-sm text-slate-600 mt-1">
          You have {priorityCount} {priorityCount === 1 ? "priority" : "priorities"} today.
        </p>
      )}
    </div>
  );
}
