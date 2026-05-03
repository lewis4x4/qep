/**
 * SheetSourcesSection — Slice 16 admin UI for the price-sheet watchdog.
 *
 * Tab lives on /admin/price-sheets. Lets admins:
 *   - List every configured source grouped by brand.
 *   - Add / edit / delete sources via a side Sheet drawer.
 *   - Toggle active.
 *   - Hit "Check now" to trigger an immediate poll (the edge function
 *     writes its own events so the refetch picks up the outcome).
 *   - See a health pill per source (green / amber / red) + the last
 *     few event types as inline badges.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyWorkspaceId } from "@/hooks/useMyWorkspaceId";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import {
  listSources,
  listRecentEventsForWorkspace,
  upsertSource,
  deleteSource,
  setSourceActive,
  triggerManualCheck,
  summarizeSourceHealth,
  formatLastChecked,
  isOverdue,
  normalizeSheetWatchBrandOptions,
  type SheetWatchBrandOption,
  type SheetSourceRow,
  type SheetSourceWithBrand,
  type SheetWatchEventRow,
} from "../lib/sheet-watchdog-api";

export function SheetSourcesSection() {
  const { data: workspaceId } = useMyWorkspaceId();
  const { toast } = useToast();

  const [sources, setSources] = useState<SheetSourceWithBrand[]>([]);
  const [events, setEvents] = useState<SheetWatchEventRow[]>([]);
  const [brands, setBrands] = useState<SheetWatchBrandOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<
    | { mode: "create" }
    | { mode: "edit"; row: SheetSourceRow }
    | null
  >(null);
  const [checking, setChecking] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const [s, e, brandsRes] = await Promise.all([
      listSources(),
      listRecentEventsForWorkspace(100),
      supabase.from("qb_brands").select("id, name, code").order("name"),
    ]);
    setSources(s);
    setEvents(e);
    setBrands(normalizeSheetWatchBrandOptions(brandsRes.data));
    setLoading(false);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // Index events by source for quick health summary
  const eventsBySource = useMemo(() => {
    const map = new Map<string, SheetWatchEventRow[]>();
    for (const e of events) {
      const arr = map.get(e.source_id) ?? [];
      arr.push(e);
      map.set(e.source_id, arr);
    }
    return map;
  }, [events]);

  const handleCheckNow = async (source: SheetSourceRow) => {
    setChecking(source.id);
    try {
      const result = await triggerManualCheck(source.id);
      if ("error" in result) {
        toast({ title: "Check failed", description: result.error, variant: "destructive" });
      } else {
        toast({ title: `Checked ${source.label}`, description: "Event log updated — reloading." });
      }
      await refetch();
    } finally {
      setChecking(null);
    }
  };

  const handleToggle = async (source: SheetSourceRow) => {
    const res = await setSourceActive(source.id, !source.active);
    if ("error" in res) {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
      return;
    }
    await refetch();
  };

  const handleDelete = async (source: SheetSourceRow) => {
    if (!confirm(`Delete source "${source.label}"? Events will also be removed.`)) return;
    const res = await deleteSource(source.id);
    if ("error" in res) {
      toast({ title: "Delete failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Source deleted" });
    await refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Price Sheet Watchdog</h2>
          <p className="text-sm text-muted-foreground">
            Configure URLs to poll for manufacturer price book updates. When a change is detected,
            we auto-ingest the new file and show the diff + in-flight quote impact before you approve.
          </p>
        </div>
        <Button onClick={() => setDrawer({ mode: "create" })}>Add source</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading sources…</p>
      ) : sources.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No sources configured yet. Add one to start watching for new price sheets automatically.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              events={eventsBySource.get(source.id) ?? []}
              checking={checking === source.id}
              onCheckNow={() => handleCheckNow(source)}
              onToggle={() => handleToggle(source)}
              onEdit={() => setDrawer({ mode: "edit", row: source })}
              onDelete={() => handleDelete(source)}
            />
          ))}
        </div>
      )}

      <SourceDrawer
        key={drawer ? (drawer.mode === "edit" ? drawer.row.id : "create") : "closed"}
        state={drawer}
        workspaceId={workspaceId ?? ""}
        brands={brands}
        onClose={() => setDrawer(null)}
        onSaved={async () => {
          setDrawer(null);
          await refetch();
        }}
      />
    </div>
  );
}

// ── Single row rendering ────────────────────────────────────────────────

function SourceRow({
  source,
  events,
  checking,
  onCheckNow,
  onToggle,
  onEdit,
  onDelete,
}: {
  source: SheetSourceWithBrand;
  events: SheetWatchEventRow[];
  checking: boolean;
  onCheckNow: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const health = summarizeSourceHealth(source, events);
  const overdue = isOverdue(source);

  let healthTone: "default" | "secondary" | "destructive" = "secondary";
  let healthLabel = "OK";
  if (health.isUnhealthy) {
    healthTone = "destructive";
    healthLabel = `Unhealthy (${source.consecutive_failures} failures)`;
  } else if (overdue && source.active) {
    healthTone = "default";
    healthLabel = "Overdue";
  }

  return (
    <Card>
      <CardContent className="p-4 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{source.label}</span>
            {source.brand_name && (
              <Badge variant="outline">{source.brand_name}</Badge>
            )}
            <Badge variant={source.active ? "default" : "secondary"}>
              {source.active ? "Active" : "Paused"}
            </Badge>
            <Badge variant={healthTone}>{healthLabel}</Badge>
          </div>
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground underline break-all mt-1 inline-block"
            >
              {source.url}
            </a>
          )}
          <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
            <span>Cadence: every {source.check_freq_hours}h</span>
            <span>{formatLastChecked(source.last_checked_at)}</span>
            {health.counts.change_detected > 0 && (
              <span>
                {health.counts.change_detected} change{health.counts.change_detected === 1 ? "" : "s"} detected
              </span>
            )}
            {health.counts.error > 0 && (
              <span className="text-destructive">
                {health.counts.error} error{health.counts.error === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {source.last_error && (
            <p className="text-xs text-destructive mt-1">
              Last error: {source.last_error}
            </p>
          )}
          {source.notes && (
            <p className="text-xs text-muted-foreground mt-1">{source.notes}</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCheckNow}
            disabled={checking || !source.active}
          >
            {checking ? "Checking…" : "Check now"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={onToggle}>
            {source.active ? "Pause" : "Resume"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Create / Edit drawer ────────────────────────────────────────────────

function SourceDrawer({
  state,
  workspaceId,
  brands,
  onClose,
  onSaved,
}: {
  state: { mode: "create" } | { mode: "edit"; row: SheetSourceRow } | null;
  workspaceId: string;
  brands: SheetWatchBrandOption[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const existing = state?.mode === "edit" ? state.row : null;

  const [brandId,   setBrandId]   = useState(existing?.brand_id ?? "");
  const [label,     setLabel]     = useState(existing?.label ?? "");
  const [url,       setUrl]       = useState(existing?.url ?? "");
  const [freqHours, setFreqHours] = useState(existing?.check_freq_hours ?? 24);
  const [notes,     setNotes]     = useState(existing?.notes ?? "");
  const [active,    setActive]    = useState(existing?.active ?? true);
  const [saving,    setSaving]    = useState(false);

  const open = state !== null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await upsertSource({
        id:               existing?.id,
        workspaceId,
        brandId,
        label,
        url:              url.trim() || null,
        checkFreqHours:   freqHours,
        notes:            notes,
        active,
      });
      if ("error" in res) {
        toast({ title: "Save failed", description: res.error, variant: "destructive" });
        return;
      }
      toast({ title: existing ? "Source updated" : "Source added" });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{existing ? "Edit source" : "Add source"}</SheetTitle>
          <SheetDescription>
            Configure a URL we should poll for price-book updates. You'll see diff + quote impact
            before any new sheet is published.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="brand">Brand</Label>
            <select
              id="brand"
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">Select a brand…</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. ASV public price book page"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://manufacturer.com/prices.pdf"
            />
            <p className="text-xs text-muted-foreground">
              We send If-None-Match on repeat polls to avoid unnecessary downloads.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="freq">Check frequency (hours)</Label>
            <Input
              id="freq"
              type="number"
              min={1}
              max={720}
              value={freqHours}
              onChange={(e) => setFreqHours(Number(e.target.value))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <textarea
              id="notes"
              value={notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context for ops — e.g. 'quarterly refresh, check around the 1st'"
              rows={3}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Active — poll this source on schedule</span>
          </label>
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !brandId || !label.trim()}>
            {saving ? "Saving…" : (existing ? "Save changes" : "Add source")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
