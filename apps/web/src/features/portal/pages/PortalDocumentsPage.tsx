import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { portalApi } from "../lib/portal-api";
import { PortalLayout } from "../components/PortalLayout";
import {
  normalizeEquipmentDocuments,
  type EquipmentDocument,
  type PortalDocumentType as DocumentType,
} from "../lib/portal-row-normalizers";
import {
  BookOpen, Wrench, Package, Shield, FileText, ClipboardCheck, Receipt, Image as ImageIcon,
  Download, ArrowLeft, FolderOpen,
} from "lucide-react";

const TYPE_META: Record<DocumentType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  operator_manual:      { label: "Operator manuals",       icon: BookOpen,       color: "text-blue-400" },
  service_manual:       { label: "Service manuals",        icon: Wrench,         color: "text-amber-400" },
  parts_manual:         { label: "Parts manuals",          icon: Package,        color: "text-violet-400" },
  warranty_certificate: { label: "Warranty certificates",  icon: Shield,         color: "text-emerald-400" },
  service_record:       { label: "Service records",        icon: FileText,       color: "text-cyan-400" },
  inspection_report:    { label: "Inspection reports",     icon: ClipboardCheck, color: "text-qep-orange" },
  invoice:              { label: "Invoices",               icon: Receipt,        color: "text-muted-foreground" },
  receipt:              { label: "Receipts",               icon: Receipt,        color: "text-muted-foreground" },
  photo:                { label: "Photos",                 icon: ImageIcon,      color: "text-pink-400" },
  other:                { label: "Other",                  icon: FolderOpen,     color: "text-muted-foreground" },
};

const TYPE_ORDER: DocumentType[] = [
  "operator_manual",
  "service_manual",
  "parts_manual",
  "warranty_certificate",
  "service_record",
  "inspection_report",
  "invoice",
  "receipt",
  "photo",
  "other",
];

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PortalDocumentsPage() {
  const [searchParams] = useSearchParams();
  const fleetId = searchParams.get("fleet_id") ?? undefined;
  const [filterType, setFilterType] = useState<DocumentType | "all">("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal", "documents", fleetId],
    queryFn: () => portalApi.getDocuments(fleetId),
    staleTime: 60_000,
  });

  const docs = normalizeEquipmentDocuments(data?.documents);

  // Group by document_type
  const grouped = useMemo(() => {
    const groups: Partial<Record<DocumentType, EquipmentDocument[]>> = {};
    for (const doc of docs) {
      const t = doc.document_type;
      if (!groups[t]) groups[t] = [];
      groups[t]!.push(doc);
    }
    return groups;
  }, [docs]);

  const filteredTypes = TYPE_ORDER.filter((t) => grouped[t] && grouped[t]!.length > 0);
  const visibleTypes = filterType === "all" ? filteredTypes : filteredTypes.filter((t) => t === filterType);

  return (
    <PortalLayout>
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          {fleetId && (
            <Button asChild variant="ghost" size="sm" className="h-7 text-[11px]">
              <Link to="/portal">
                <ArrowLeft className="mr-1 h-3 w-3" aria-hidden />
                Back to fleet
              </Link>
            </Button>
          )}
        </div>
        <h1 className="text-xl font-bold text-foreground">
          {fleetId ? "Equipment Documents" : "Document Library"}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Operator manuals, service records, warranty certificates, and more — by machine.
        </p>
      </div>

      {/* Type filter chips */}
      {filteredTypes.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <FilterChip label={`All (${docs.length})`} active={filterType === "all"} onClick={() => setFilterType("all")} />
          {filteredTypes.map((t) => {
            const meta = TYPE_META[t];
            const Icon = meta.icon;
            const count = grouped[t]?.length ?? 0;
            return (
              <FilterChip
                key={t}
                label={`${meta.label} (${count})`}
                icon={<Icon className={`h-3 w-3 ${meta.color}`} aria-hidden />}
                active={filterType === t}
                onClick={() => setFilterType(t)}
              />
            );
          })}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-20 animate-pulse" />)}
        </div>
      )}

      {/* Error */}
      {isError && (
        <Card className="border-red-500/20 p-6 text-center">
          <p className="text-sm text-red-400">Failed to load documents.</p>
        </Card>
      )}

      {/* Empty */}
      {!isLoading && !isError && docs.length === 0 && (
        <Card className="border-dashed p-6 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground mb-2" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {fleetId
              ? "No documents uploaded for this equipment yet."
              : "No documents in your library yet. Your dealer will upload manuals, warranty certificates, and service records here."}
          </p>
        </Card>
      )}

      {/* Grouped list */}
      {!isLoading && !isError && docs.length > 0 && (
        <div className="space-y-4">
          {visibleTypes.map((type) => {
            const meta = TYPE_META[type];
            const Icon = meta.icon;
            const items = grouped[type] ?? [];
            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`h-4 w-4 ${meta.color}`} aria-hidden />
                  <h2 className="text-sm font-bold text-foreground">{meta.label}</h2>
                  <span className="text-[10px] text-muted-foreground">({items.length})</span>
                </div>
                <div className="space-y-2">
                  {items.map((doc) => (
                    <Card key={doc.id} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{doc.title}</p>
                          {doc.description && (
                            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{doc.description}</p>
                          )}
                          <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                            <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                            {doc.mime_type && <span>{doc.mime_type}</span>}
                            {doc.file_size_bytes !== null && <span>{formatBytes(doc.file_size_bytes)}</span>}
                          </div>
                          {doc.portal_visibility && (
                            <div className="mt-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                {doc.portal_visibility.label}
                              </p>
                              <p className="mt-1 text-[11px] text-foreground">{doc.portal_visibility.detail}</p>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                Released: {new Date(doc.portal_visibility.released_at).toLocaleDateString()}
                              </p>
                            </div>
                          )}
                        </div>
                        <Button asChild size="sm" variant="outline" className="h-7 shrink-0 text-[11px]">
                          <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                            <Download className="mr-1 h-3 w-3" aria-hidden />
                            Open
                          </a>
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PortalLayout>
  );
}

/* ── Subcomponent ────────────────────────────────────────────────── */

function FilterChip({
  label, icon, active, onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "border-qep-orange bg-qep-orange/10 text-qep-orange"
          : "border-border text-muted-foreground hover:border-foreground/20"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
