import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PhoneCall, Mail, MapPin, StickyNote } from "lucide-react";
import { logSalesActivity } from "../lib/sales-api";
import { useToast } from "@/hooks/use-toast";

interface QuickLogSheetProps {
  companyId?: string;
  dealId?: string;
  onLogged?: () => void;
}

export function QuickLogSheet({ companyId, dealId, onLogged }: QuickLogSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const hasSubject = Boolean(dealId || companyId);

  async function save(type: "call" | "email" | "visit" | "note", body?: string) {
    if (!hasSubject) {
      toast({
        title: "Activity subject required",
        description: "Open a deal or customer before logging activity.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await logSalesActivity({
        activityType: type,
        companyId,
        dealId,
        body,
      });
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      onLogged?.();
    } catch (err) {
      toast({
        title: "Failed to log activity",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-foreground">Quick log</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={saving || !hasSubject}
          onClick={() => save("call")}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-foreground/[0.04] py-3 text-sm font-semibold text-foreground disabled:opacity-40"
        >
          <PhoneCall className="h-4 w-4 text-qep-orange" />
          Call
        </button>
        <button
          type="button"
          disabled={saving || !hasSubject}
          onClick={() => save("email")}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-foreground/[0.04] py-3 text-sm font-semibold text-foreground disabled:opacity-40"
        >
          <Mail className="h-4 w-4 text-qep-orange" />
          Email
        </button>
        <button
          type="button"
          disabled={saving || !hasSubject}
          onClick={() => save("visit")}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-foreground/[0.04] py-3 text-sm font-semibold text-foreground disabled:opacity-40"
        >
          <MapPin className="h-4 w-4 text-qep-orange" />
          Visit
        </button>
        <button
          type="button"
          disabled={saving || !hasSubject || !noteText.trim()}
          onClick={() => save("note", noteText.trim())}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-foreground/[0.04] py-3 text-sm font-semibold text-foreground disabled:opacity-40"
        >
          <StickyNote className="h-4 w-4 text-qep-orange" />
          Note
        </button>
      </div>
      <textarea
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder="Optional note for quick note action"
        rows={3}
        className="w-full rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-qep-orange/30"
      />
    </div>
  );
}
