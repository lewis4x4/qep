import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Camera } from "lucide-react";

interface ChecklistItem {
  item: string;
  completed: boolean;
  photo_url?: string;
  notes?: string;
}

interface InspectionChecklistProps {
  items: ChecklistItem[];
  onUpdate: (items: ChecklistItem[]) => void;
  title?: string;
}

export function InspectionChecklist({ items, onUpdate, title = "Inspection Checklist" }: InspectionChecklistProps) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>(items);

  const toggleItem = (index: number) => {
    const updated = [...checklist];
    updated[index] = { ...updated[index], completed: !updated[index].completed };
    setChecklist(updated);
    onUpdate(updated);
  };

  const completed = checklist.filter((i) => i.completed).length;
  const total = checklist.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">{completed}/{total} ({pct}%)</span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted mb-4">
        <div className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-qep-orange"}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="space-y-1">
        {checklist.map((item, index) => (
          <button
            key={index}
            onClick={() => toggleItem(index)}
            className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition min-h-[48px] ${
              item.completed ? "bg-emerald-500/5 border border-emerald-500/20" : "bg-card border border-border hover:border-foreground/20"
            }`}
          >
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
              item.completed ? "border-emerald-500 bg-emerald-500" : "border-muted-foreground"
            }`}>
              {item.completed && <Check className="h-3.5 w-3.5 text-white" />}
            </div>
            <span className={`flex-1 text-sm ${item.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {item.item}
            </span>
            <Camera className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    </Card>
  );
}
