import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  getDocumentNeighborsViaRouter,
  rerunTwinViaRouter,
  type DocumentCenterGetResponse,
  type DocumentCenterNeighbor,
} from "@/features/documents/router";
import { ContextPaneFacts } from "./ContextPaneFacts";
import { ContextPaneNeighbors } from "./ContextPaneNeighbors";
import { AskBox } from "./AskBox";

export interface ContextPaneProps {
  detail: DocumentCenterGetResponse | null;
  loading: boolean;
  onDownload: () => void;
  onReloadDetail: () => void;
  downloading: boolean;
}

function formatTokenLabel(value: string): string {
  return value.split("_").join(" ");
}

export function ContextPane({ detail, loading, onDownload, onReloadDetail, downloading }: ContextPaneProps) {
  const [neighbors, setNeighbors] = useState<DocumentCenterNeighbor[]>([]);
  const [loadingNeighbors, setLoadingNeighbors] = useState(false);
  const [membershipsOpen, setMembershipsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [twinRunning, setTwinRunning] = useState(false);
  const { toast } = useToast();

  const documentId = detail?.document.id ?? null;

  useEffect(() => {
    if (!documentId) {
      setNeighbors([]);
      setLoadingNeighbors(false);
      return;
    }
    let cancelled = false;
    setLoadingNeighbors(true);
    void getDocumentNeighborsViaRouter(documentId)
      .then((payload) => {
        if (!cancelled) setNeighbors(payload.neighbors);
      })
      .catch(() => {
        if (!cancelled) setNeighbors([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingNeighbors(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  async function handleRunTwin(force: boolean) {
    if (!documentId) return;
    setTwinRunning(true);
    try {
      const payload = await rerunTwinViaRouter({ documentId, force });
      toast({
        title: payload.status === "succeeded"
          ? `Twin extracted ${payload.factCount} fact${payload.factCount === 1 ? "" : "s"}`
          : `Twin ${payload.status}`,
        description: payload.traceId ? `Trace ${payload.traceId.slice(0, 8)}…` : undefined,
      });
      onReloadDetail();
    } catch (err) {
      toast({
        title: "Twin run failed",
        description: err instanceof Error ? err.message : "Could not run twin extraction",
        variant: "destructive",
      });
    } finally {
      setTwinRunning(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Document Context</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading document…</CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Document Context</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Select a document to see its facts, obligations, and ask questions against it.
        </CardContent>
      </Card>
    );
  }

  const { document, memberships, auditEvents, facts } = detail;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Document Context</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{document.title}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline" className="text-[10px] uppercase">
              {formatTokenLabel(document.audience)}
            </Badge>
            <Badge variant={document.status === "published" ? "default" : "secondary"}>
              {formatTokenLabel(document.status)}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Updated {new Date(document.updatedAt).toLocaleString()}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onDownload}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleRunTwin(facts.length === 0)}
            disabled={twinRunning}
            title={facts.length === 0 ? "Run twin extraction" : "Re-run twin extraction"}
          >
            {twinRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2 hidden sm:inline">
              {facts.length === 0 ? "Run twin" : "Re-run twin"}
            </span>
          </Button>
        </div>

        <section>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Facts ({facts.length})
          </p>
          <ContextPaneFacts facts={facts} />
        </section>

        <section>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Obligations ({neighbors.length})
          </p>
          <ContextPaneNeighbors neighbors={neighbors} loading={loadingNeighbors} />
        </section>

        <section>
          <AskBox documentId={document.id} />
        </section>

        <section>
          <button
            type="button"
            className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={() => setMembershipsOpen((prev) => !prev)}
          >
            Memberships ({memberships.length})
            {membershipsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {membershipsOpen ? (
            <div className="mt-2 space-y-1">
              {memberships.length === 0 ? (
                <p className="text-xs text-muted-foreground">Unfiled</p>
              ) : (
                memberships.map((membership) => (
                  <div key={membership.folderId} className="rounded-md border border-border px-2 py-1">
                    <p className="text-xs font-medium text-foreground">
                      {membership.folder?.name ?? membership.folderId}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      sort {membership.sortOrder} · added {new Date(membership.addedAt).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </section>

        <section>
          <button
            type="button"
            className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={() => setActivityOpen((prev) => !prev)}
          >
            Recent Activity ({auditEvents.length})
            {activityOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {activityOpen ? (
            <div className="mt-2 space-y-1">
              {auditEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No audit events yet.</p>
              ) : (
                auditEvents.slice(0, 8).map((event) => (
                  <div key={event.id} className="rounded-md border border-border px-2 py-1">
                    <p className="text-xs font-medium text-foreground">{formatTokenLabel(event.eventType)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}
