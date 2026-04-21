import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, ExternalLink, Loader2 } from "lucide-react";

import { RequireAdmin } from "@/components/RequireAdmin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  createDownloadUrlViaRouter,
  getDocumentViaRouter,
  type DocumentCenterGetResponse,
} from "@/features/documents/router";

interface ChunkRow {
  id: string;
  chunk_index: number;
  content: string;
  chunk_kind: string | null;
  metadata: Record<string, unknown> | null;
}

export function DocumentViewerPage() {
  return (
    <RequireAdmin roles={["rep", "admin", "manager", "owner"]}>
      <DocumentViewerInner />
    </RequireAdmin>
  );
}

function DocumentViewerInner() {
  const { id: documentId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const targetChunkId = searchParams.get("chunk");
  const { toast } = useToast();

  const [detail, setDetail] = useState<DocumentCenterGetResponse | null>(null);
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const chunkRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const loadAll = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    try {
      const [detailPayload, chunksResult] = await Promise.all([
        getDocumentViaRouter(documentId),
        supabase
          .from("chunks")
          .select("id, chunk_index, content, chunk_kind, metadata")
          .eq("document_id", documentId)
          .order("chunk_index", { ascending: true }),
      ]);
      setDetail(detailPayload);
      if (chunksResult.error) throw chunksResult.error;
      setChunks((chunksResult.data ?? []) as ChunkRow[]);
    } catch (err) {
      toast({
        title: "Viewer failed to load",
        description: err instanceof Error ? err.message : "Could not load document",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [documentId, toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!targetChunkId || chunks.length === 0) return;
    const node = chunkRefs.current.get(targetChunkId);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [targetChunkId, chunks]);

  async function handleDownload() {
    if (!documentId) return;
    setDownloading(true);
    try {
      const payload = await createDownloadUrlViaRouter(documentId);
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Could not fetch download URL",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  const paragraphChunks = useMemo(
    () => chunks.filter((c) => (c.chunk_kind ?? "paragraph") === "paragraph"),
    [chunks],
  );

  if (!documentId) {
    return <div className="p-6 text-sm text-muted-foreground">No document id provided.</div>;
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/documents">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {detail?.document.title ?? (loading ? "Loading…" : "Document")}
            </h1>
            {detail ? (
              <div className="mt-1 flex gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">
                  {detail.document.audience.replace(/_/g, " ")}
                </Badge>
                <Badge variant={detail.document.status === "published" ? "default" : "secondary"}>
                  {detail.document.status.replace(/_/g, " ")}
                </Badge>
                {detail.facts.length > 0 ? (
                  <Badge variant="secondary">{detail.facts.length} facts</Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void handleDownload()} disabled={downloading}>
            {downloading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
            Download original
          </Button>
          {detail?.document.sourceUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={detail.document.sourceUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" />
                Source
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Content</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : paragraphChunks.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              This document has no extracted paragraph chunks yet. Download the original to view it.
            </div>
          ) : (
            <div className="space-y-2">
              {targetChunkId ? (
                <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-500">
                  Deep-linked to chunk {targetChunkId.slice(0, 8)}… (highlighted below).
                </p>
              ) : null}
              {paragraphChunks.map((chunk) => {
                const isTarget = chunk.id === targetChunkId;
                const pageNumber = typeof chunk.metadata?.page_number === "number" ? chunk.metadata.page_number : null;
                const sectionTitle =
                  typeof chunk.metadata?.section_title === "string" ? chunk.metadata.section_title : null;
                return (
                  <div
                    key={chunk.id}
                    ref={(node) => {
                      if (node) chunkRefs.current.set(chunk.id, node);
                      else chunkRefs.current.delete(chunk.id);
                    }}
                    id={`chunk-${chunk.id}`}
                    className={cn(
                      "rounded-md border px-3 py-2 transition-colors",
                      isTarget
                        ? "border-amber-400/80 bg-amber-400/10 shadow-sm"
                        : "border-border/60 hover:border-border",
                    )}
                  >
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                      <span>
                        chunk {chunk.chunk_index}
                        {pageNumber !== null ? ` · page ${pageNumber}` : ""}
                        {sectionTitle ? ` · ${sectionTitle}` : ""}
                      </span>
                      {isTarget ? <span className="text-amber-500">Target</span> : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{chunk.content}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
