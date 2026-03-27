import { useState, useEffect } from "react";
import { FileText, Mic, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface ActivityItem {
  id: string;
  type: "document" | "voice_capture";
  title: string;
  timestamp: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function RecentActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      const [docsResult, voiceResult] = await Promise.all([
        supabase
          .from("documents")
          .select("id, title, created_at")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("voice_captures")
          .select("id, created_at, extracted_data")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      const docItems: ActivityItem[] = (docsResult.data ?? []).map((d) => ({
        id: d.id,
        type: "document",
        title: `Document uploaded: ${d.title}`,
        timestamp: d.created_at,
      }));

      const voiceItems: ActivityItem[] = (voiceResult.data ?? []).map((v) => {
        const extracted = v.extracted_data as { customer_name?: string } | null;
        const label = extracted?.customer_name
          ? `Voice capture: ${extracted.customer_name}`
          : "Voice capture recorded";
        return { id: v.id, type: "voice_capture", title: label, timestamp: v.created_at };
      });

      const merged = [...docItems, ...voiceItems]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);

      setItems(merged);
      setLoading(false);
    }
    fetchActivity();
  }, []);

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground mb-4">Recent Activity</h2>
      <div className="bg-card rounded-lg border border-border divide-y divide-border">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
              <div className="w-8 h-8 bg-muted rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-muted rounded w-2/3" />
                <div className="h-2.5 bg-muted rounded w-1/4" />
              </div>
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
            <Clock className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">No activity yet</p>
            <p className="text-xs mt-0.5">Actions will appear here as your team gets started</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-full bg-[hsl(var(--qep-orange-light))] flex items-center justify-center shrink-0">
                {item.type === "document" ? (
                  <FileText className="w-4 h-4 text-[hsl(var(--qep-orange))]" />
                ) : (
                  <Mic className="w-4 h-4 text-[hsl(var(--qep-orange))]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{item.title}</p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{timeAgo(item.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
