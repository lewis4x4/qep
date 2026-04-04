import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Mic,
  Search,
  Loader2,
  AlertTriangle,
  ChevronDown,
  Volume2,
  Clock,
  Calendar,
  User,
  Building2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { UserRole } from "../lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface VoiceHistoryPageProps {
  userRole: UserRole;
}

interface VoiceNote {
  id: string;
  created_at: string;
  duration_seconds: number | null;
  transcript: string | null;
  sync_status: string;
  sync_error: string | null;
  hubspot_deal_id: string | null;
  user_id: string;
  sentiment: string | null;
  manager_attention: boolean | null;
  competitor_mentions: string[] | null;
}

const PAGE_SIZE = 20;

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "bg-green-500/15 text-green-400",
  neutral: "bg-zinc-500/15 text-zinc-400",
  negative: "bg-red-500/15 text-red-400",
  mixed: "bg-amber-500/15 text-amber-400",
};

export function VoiceHistoryPage({ userRole }: VoiceHistoryPageProps) {
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<string>("");
  const [managerFilter, setManagerFilter] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);

  const isElevated = ["manager", "owner"].includes(userRole);

  const loadNotes = useCallback(async (pageNum: number, append = false) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const db = supabase;
      let query = db
        .from("voice_captures")
        .select("id, created_at, duration_seconds, transcript, sync_status, sync_error, hubspot_deal_id, user_id, sentiment, manager_attention, competitor_mentions")
        .order("created_at", { ascending: false })
        .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1);

      if (!isElevated) {
        query = query.eq("user_id", user.id);
      }

      if (searchQuery.trim()) {
        query = query.ilike("transcript", `%${searchQuery.trim()}%`);
      }

      if (sentimentFilter) {
        query = query.eq("sentiment", sentimentFilter);
      }

      if (managerFilter) {
        query = query.eq("manager_attention", true);
      }

      const { data, error } = await query;
      if (error) {
        console.error("Failed to load voice notes:", error);
        return;
      }

      const rows = (data ?? []) as VoiceNote[];
      setHasMore(rows.length === PAGE_SIZE);
      setNotes(append ? prev => [...prev, ...rows] : rows);
    } finally {
      setLoading(false);
    }
  }, [isElevated, searchQuery, sentimentFilter, managerFilter]);

  useEffect(() => {
    setPage(0);
    loadNotes(0);
  }, [loadNotes]);

  function loadMore() {
    const next = page + 1;
    setPage(next);
    loadNotes(next, true);
  }

  async function playAudio(noteId: string, storagePath?: string) {
    if (!storagePath) return;
    if (playingId === noteId) {
      setPlayingId(null);
      return;
    }

    if (!audioUrls[noteId]) {
      const { data } = await supabase.storage
        .from("voice-recordings")
        .createSignedUrl(storagePath, 3600);
      if (data?.signedUrl) {
        setAudioUrls(prev => ({ ...prev, [noteId]: data.signedUrl }));
      }
    }
    setPlayingId(noteId);
  }

  function formatDuration(seconds: number | null): string {
    if (seconds == null) return "—";
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/voice"><ArrowLeft className="mr-1 h-4 w-4" /> Record</Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Mic className="h-5 w-5 text-qep-orange" />
              Voice Notes
            </h1>
            <p className="text-sm text-muted-foreground">
              {isElevated ? "All team voice notes" : "Your recorded field notes"}
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search transcripts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <select
          value={sentimentFilter}
          onChange={(e) => setSentimentFilter(e.target.value)}
          className="flex h-10 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
        >
          <option value="">All sentiments</option>
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
          <option value="mixed">Mixed</option>
        </select>

        {isElevated && (
          <Button
            variant={managerFilter ? "default" : "outline"}
            size="sm"
            onClick={() => setManagerFilter(!managerFilter)}
            className="gap-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Flagged
          </Button>
        )}
      </div>

      {/* Notes list */}
      {loading && notes.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading voice notes...
        </div>
      ) : notes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Mic className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No voice notes found</p>
            {searchQuery && (
              <p className="text-xs text-muted-foreground mt-1">Try a different search term</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <Card key={note.id} className="hover:border-white/20 transition-colors">
              <CardContent className="py-4 px-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Transcript snippet */}
                    <p className="text-sm text-foreground line-clamp-2">
                      {note.transcript?.trim() || "No transcript"}
                    </p>

                    {/* Meta row */}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(note.created_at)}
                      </span>
                      {note.duration_seconds != null && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(note.duration_seconds)}
                        </span>
                      )}
                      {note.hubspot_deal_id && (
                        <Link
                          to={`/crm/deals/${note.hubspot_deal_id}`}
                          className="flex items-center gap-1 text-qep-orange hover:underline"
                        >
                          <Building2 className="h-3 w-3" />
                          Linked deal
                        </Link>
                      )}
                      {isElevated && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {note.user_id.slice(0, 8)}
                        </span>
                      )}
                    </div>

                    {/* Badges row */}
                    <div className="flex flex-wrap gap-1.5">
                      {note.sentiment && (
                        <Badge variant="outline" className={cn("text-[10px]", SENTIMENT_COLORS[note.sentiment])}>
                          {note.sentiment}
                        </Badge>
                      )}
                      {note.manager_attention && (
                        <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-400">
                          <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                          Flagged
                        </Badge>
                      )}
                      {note.competitor_mentions?.map((c) => (
                        <Badge key={c} variant="outline" className="text-[10px] bg-violet-500/15 text-violet-400">
                          {c}
                        </Badge>
                      ))}
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]",
                          note.sync_status === "synced"
                            ? "bg-green-500/15 text-green-400"
                            : note.sync_status === "error"
                              ? "bg-red-500/15 text-red-400"
                              : "bg-zinc-500/15 text-zinc-400"
                        )}
                      >
                        {note.sync_status}
                      </Badge>
                    </div>
                  </div>

                  {/* Audio play button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => playAudio(note.id)}
                  >
                    <Volume2 className={cn("h-4 w-4", playingId === note.id ? "text-qep-orange" : "")} />
                  </Button>
                </div>

                {/* Audio player */}
                {playingId === note.id && audioUrls[note.id] && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <audio
                      controls
                      autoPlay
                      src={audioUrls[note.id]}
                      className="w-full h-8"
                      onEnded={() => setPlayingId(null)}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loading}
                className="gap-1.5"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
