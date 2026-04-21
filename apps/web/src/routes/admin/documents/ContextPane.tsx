import { Download, Loader2 } from "lucide-react";

import type { DocumentCenterGetResponse } from "@/features/documents/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface ContextPaneProps {
  detail: DocumentCenterGetResponse | null;
  loading: boolean;
  onDownload: () => void;
  downloading: boolean;
}

function formatTokenLabel(value: string): string {
  return value.split("_").join(" ");
}

export function ContextPane({ detail, loading, onDownload, downloading }: ContextPaneProps) {
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
          Select a document to see metadata, memberships, and recent activity.
        </CardContent>
      </Card>
    );
  }

  const { document, memberships, auditEvents } = detail;

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

        <Button type="button" variant="outline" className="w-full" onClick={onDownload} disabled={downloading}>
          {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Download
        </Button>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Memberships</p>
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
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent Activity</p>
          <div className="mt-2 space-y-2">
            {auditEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No audit events yet.</p>
            ) : (
              auditEvents.slice(0, 6).map((event) => (
                <div key={event.id} className="rounded-md border border-border px-2 py-1">
                  <p className="text-xs font-medium text-foreground">{formatTokenLabel(event.eventType)}</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
