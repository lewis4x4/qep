import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, UserCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type SpeakerLabel = Database["public"]["Tables"]["voice_capture_speaker_labels"]["Row"];

type SpeakerLabelStatus = "suggested" | "confirmed" | "rejected";

interface VoiceSpeakerLabelPanelProps {
  captureId: string;
  compact?: boolean;
}

function labelDisplayName(label: SpeakerLabel): string {
  return label.assigned_display_name ?? label.suggested_display_name ?? "Unnamed speaker";
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "confirmed") return "default";
  if (status === "rejected") return "destructive";
  return "secondary";
}

function sourceLabel(source: string): string {
  return source
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function VoiceSpeakerLabelPanel({ captureId, compact = false }: VoiceSpeakerLabelPanelProps) {
  const { toast } = useToast();
  const [labels, setLabels] = useState<SpeakerLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [busyLabelId, setBusyLabelId] = useState<string | null>(null);

  const loadLabels = useCallback(async () => {
    if (!captureId) return;
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("voice_capture_speaker_labels")
      .select("*")
      .eq("voice_capture_id", captureId)
      .order("speaker_key", { ascending: true });

    if (loadError) {
      setError("Speaker label suggestions could not be loaded.");
      setLabels([]);
    } else {
      const rows = (data ?? []) as SpeakerLabel[];
      setLabels(rows);
      setDraftNames((previous) => {
        const next = { ...previous };
        for (const label of rows) {
          next[label.id] = next[label.id] ?? labelDisplayName(label);
        }
        return next;
      });
    }

    setLoading(false);
  }, [captureId]);

  useEffect(() => {
    void loadLabels();
  }, [loadLabels]);

  const suggestedCount = useMemo(
    () => labels.filter((label) => label.status === "suggested").length,
    [labels],
  );

  async function confirmLabel(label: SpeakerLabel) {
    const displayName = (draftNames[label.id] ?? labelDisplayName(label)).trim();
    if (!displayName) {
      toast({ title: "Name required", description: "Enter a speaker label before confirming." });
      return;
    }

    setBusyLabelId(label.id);
    const { data, error: rpcError } = await supabase.rpc("confirm_voice_capture_speaker_label", {
      p_label_id: label.id,
      p_display_name: displayName,
      p_entity_type: label.suggested_entity_type ?? undefined,
      p_entity_id: label.suggested_entity_id ?? undefined,
    });
    setBusyLabelId(null);

    if (rpcError || !data) {
      toast({ title: "Could not confirm speaker", description: "Try again or refresh this capture." });
      return;
    }

    setLabels((current) => current.map((item) => item.id === label.id ? data as SpeakerLabel : item));
    setEditingId(null);
    toast({ title: "Speaker label confirmed", description: `${displayName} is now assigned to this capture.` });
  }

  async function rejectLabel(label: SpeakerLabel) {
    setBusyLabelId(label.id);
    const { data, error: rpcError } = await supabase.rpc("reject_voice_capture_speaker_label", {
      p_label_id: label.id,
    });
    setBusyLabelId(null);

    if (rpcError || !data) {
      toast({ title: "Could not reject speaker", description: "Try again or refresh this capture." });
      return;
    }

    setLabels((current) => current.map((item) => item.id === label.id ? data as SpeakerLabel : item));
    setEditingId(null);
    toast({ title: "Speaker suggestion rejected", description: "The recommendation remains auditable but unassigned." });
  }

  if (loading) {
    return (
      <Card className={cn("border-border bg-muted/20", compact && "shadow-none")}>
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading speaker label suggestions...
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn("border-amber-500/30 bg-amber-500/5", compact && "shadow-none")}>
        <CardContent className="py-4 text-sm text-amber-700 dark:text-amber-200">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (labels.length === 0) {
    return null;
  }

  return (
    <Card className={cn("border-border bg-card", compact && "shadow-none")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>Speaker labels</span>
          <Badge variant="secondary">{suggestedCount} suggested</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Suggested speaker label — not assigned yet. Confirm to apply this label.
        </p>
        {labels.map((label) => {
          const isSuggested = label.status === "suggested";
          const isEditing = editingId === label.id;
          const displayName = draftNames[label.id] ?? labelDisplayName(label);
          const busy = busyLabelId === label.id;

          return (
            <div key={label.id} className="rounded-lg border border-border bg-background/60 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{label.speaker_key}</p>
                    <Badge variant={statusVariant(label.status)}>{label.status as SpeakerLabelStatus}</Badge>
                  </div>
                  <p className="break-words text-sm text-foreground">{labelDisplayName(label)}</p>
                  <p className="text-xs text-muted-foreground">
                    Source: {sourceLabel(label.suggestion_source)}
                    {label.suggestion_confidence != null ? ` · ${Math.round(label.suggestion_confidence * 100)}% confidence` : ""}
                  </p>
                </div>
              </div>

              {isSuggested && (
                <div className="mt-3 space-y-2">
                  {isEditing && (
                    <Input
                      aria-label={`Speaker name for ${label.speaker_key}`}
                      value={displayName}
                      onChange={(event) => setDraftNames((current) => ({
                        ...current,
                        [label.id]: event.target.value,
                      }))}
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void confirmLabel(label)}
                      disabled={busy}
                    >
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserCheck className="mr-2 h-4 w-4" />}
                      Confirm
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingId(isEditing ? null : label.id)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit name
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void rejectLabel(label)}
                      disabled={busy}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
