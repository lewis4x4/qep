import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Upload, FileText, Trash2, ToggleLeft, ToggleRight, Cloud, RefreshCw, Search, X, MoreVertical, Loader2, NotebookPen, GitMerge, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database, UserRole } from "../lib/database.types";
import { UsersTab } from "./UsersTab";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Document = Database["public"]["Tables"]["documents"]["Row"];
type DocumentAudience = "company_wide" | "finance" | "leadership" | "admin_owner" | "owner_only";
type DocumentStatus = "draft" | "pending_review" | "published" | "archived" | "ingest_failed";

const SUPPORTED_UPLOAD_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".xls", ".txt", ".md", ".csv"] as const;
const SUPPORTED_UPLOAD_EXTENSION_SET = new Set<string>(SUPPORTED_UPLOAD_EXTENSIONS);
const SUPPORTED_UPLOAD_ACCEPT = SUPPORTED_UPLOAD_EXTENSIONS.join(",");
const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_SIZE_LABEL = "50 MB";
const DOCUMENT_AUDIENCE_OPTIONS: Array<{ value: DocumentAudience; label: string }> = [
  { value: "company_wide", label: "Company-wide" },
  { value: "finance", label: "Finance" },
  { value: "leadership", label: "Leadership" },
  { value: "admin_owner", label: "Admin + Owner" },
  { value: "owner_only", label: "Owner only" },
];
const DOCUMENT_STATUS_OPTIONS: Array<{ value: DocumentStatus; label: string }> = [
  { value: "published", label: "Published" },
  { value: "draft", label: "Draft" },
  { value: "pending_review", label: "Pending review" },
  { value: "archived", label: "Archived" },
  { value: "ingest_failed", label: "Ingest failed" },
];
const DOCUMENT_FILTERS = ["all", "published", "pending_review", "draft", "archived", "ingest_failed"] as const;

interface FeedbackRow {
  id: string;
  content: string;
  feedback: "up" | "down";
  created_at: string;
  conversation_id: string;
  user_email?: string;
}

function ChatInsightsPanel() {
  const [stats, setStats] = useState<{
    total: number;
    thumbsUp: number;
    thumbsDown: number;
    conversations: number;
  } | null>(null);
  const [recentFeedback, setRecentFeedback] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;

      const [upRes, downRes, convoRes] = await Promise.all([
        db.from("chat_messages").select("id", { count: "exact", head: true }).eq("feedback", "up"),
        db.from("chat_messages").select("id", { count: "exact", head: true }).eq("feedback", "down"),
        db.from("chat_conversations").select("id", { count: "exact", head: true }),
      ]);

      setStats({
        thumbsUp: upRes.count ?? 0,
        thumbsDown: downRes.count ?? 0,
        total: (upRes.count ?? 0) + (downRes.count ?? 0),
        conversations: convoRes.count ?? 0,
      });

      const { data: recent } = await db
        .from("chat_messages")
        .select("id, content, feedback, created_at, conversation_id")
        .not("feedback", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);

      setRecentFeedback((recent ?? []) as FeedbackRow[]);
      setLoading(false);
    }
    void load();
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading chat insights...</div>;
  }

  const approvalRate = stats && stats.total > 0
    ? Math.round((stats.thumbsUp / stats.total) * 100)
    : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{stats?.conversations ?? 0}</p>
            <p className="text-xs text-muted-foreground">Total Conversations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{stats?.total ?? 0}</p>
            <p className="text-xs text-muted-foreground">Feedback Signals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-green-600">{stats?.thumbsUp ?? 0}</p>
            <p className="text-xs text-muted-foreground">Thumbs Up</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className={cn("text-2xl font-bold", (stats?.thumbsDown ?? 0) > 0 ? "text-red-500" : "")}>
              {stats?.thumbsDown ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">Thumbs Down</p>
          </CardContent>
        </Card>
      </div>

      {approvalRate !== null && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-3 flex-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${approvalRate}%` }}
                />
              </div>
              <span className="text-sm font-medium tabular-nums">{approvalRate}% approval</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-3">Recent Feedback</h3>
        {recentFeedback.length === 0 ? (
          <p className="text-sm text-muted-foreground">No feedback yet.</p>
        ) : (
          <div className="space-y-2">
            {recentFeedback.map((row) => (
              <Card key={row.id}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    <span className={cn(
                      "mt-0.5 shrink-0 text-lg",
                      row.feedback === "up" ? "text-green-500" : "text-red-500",
                    )}>
                      {row.feedback === "up" ? "👍" : "👎"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm line-clamp-2">{row.content}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(row.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface KnowledgeGap {
  id: string;
  question: string;
  created_at: string;
  resolved: boolean;
}

function KnowledgeGapsPanel() {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const db = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      const { data } = await db
        .from("knowledge_gaps")
        .select("id, question, created_at, resolved")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(50);
      setGaps((data ?? []) as KnowledgeGap[]);
      setLoading(false);
    }
    load();
  }, []);

  async function resolveGap(id: string) {
    const db = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    await db.from("knowledge_gaps").update({ resolved: true }).eq("id", id);
    setGaps((prev) => prev.filter((g) => g.id !== id));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading knowledge gaps...
      </div>
    );
  }

  if (gaps.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No unanswered questions detected yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Questions the knowledge base can&apos;t answer will appear here so you know what documents to add.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        These are questions users asked that the knowledge base couldn&apos;t find answers for.
        Upload relevant documents or add CRM data to resolve them.
      </p>
      <div className="space-y-2">
        {gaps.map((gap) => (
          <Card key={gap.id}>
            <CardContent className="py-3 px-4 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{gap.question}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(gap.created_at).toLocaleDateString([], {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resolveGap(gap.id)}
                className="shrink-0 text-xs"
              >
                Resolve
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export interface AdminPageProps {
  userRole: UserRole;
  userId: string;
}

const ROLE_SUBTITLES: Record<UserRole, string> = {
  owner: "Manage your team, knowledge base, and integrations.",
  manager: "Manage team knowledge and documents.",
  admin: "Manage knowledge base documents.",
  rep: "",
};

function getFileExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

function validateKnowledgeBaseFile(file: File): string | null {
  const extension = getFileExtension(file.name);
  if (!SUPPORTED_UPLOAD_EXTENSION_SET.has(extension)) {
    return `Unsupported file type. Allowed: ${SUPPORTED_UPLOAD_EXTENSIONS.join(", ")}.`;
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `File exceeds ${MAX_UPLOAD_SIZE_LABEL} limit.`;
  }

  return null;
}

function formatAudienceLabel(audience: DocumentAudience | null | undefined): string {
  return DOCUMENT_AUDIENCE_OPTIONS.find((option) => option.value === audience)?.label ?? "Unknown";
}

function formatStatusLabel(status: DocumentStatus | null | undefined): string {
  return DOCUMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Unknown";
}

export function AdminPage({ userRole, userId }: AdminPageProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<"uploading" | "processing" | "done">("uploading");
  const [dragOver, setDragOver] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [editTarget, setEditTarget] = useState<Document | null>(null);
  const [editAudience, setEditAudience] = useState<DocumentAudience>("company_wide");
  const [editStatus, setEditStatus] = useState<DocumentStatus>("draft");
  const [editReviewDueAt, setEditReviewDueAt] = useState("");
  const [editReviewOwnerUserId, setEditReviewOwnerUserId] = useState("");
  const [reviewAssignees, setReviewAssignees] = useState<
    Array<{ id: string; full_name: string | null; email: string | null }>
  >([]);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [docSearch, setDocSearch] = useState("");
  const [docFilter, setDocFilter] = useState<(typeof DOCUMENT_FILTERS)[number]>("all");
  const [uploadAudience, setUploadAudience] = useState<DocumentAudience>("company_wide");
  const [uploadStatus, setUploadStatus] = useState<Extract<DocumentStatus, "draft" | "published">>("published");

  const canManageDocs = ["admin", "manager", "owner"].includes(userRole);
  const canReviewDocs = userRole === "admin" || userRole === "owner";

  useEffect(() => {
    void loadDocuments();
  }, []);

  useEffect(() => {
    if (!canReviewDocs) return;
    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .in("role", ["admin", "manager", "owner"])
        .order("full_name", { ascending: true });
      if (!error && data) {
        setReviewAssignees(
          data.map((row) => ({
            id: row.id,
            full_name: row.full_name,
            email: row.email,
          })),
        );
      }
    })();
  }, [canReviewDocs]);

  async function loadDocuments(): Promise<void> {
    // Elevated roles: RLS allows full document rows (see migrations on documents_select_elevated_all).
    const { data, error } = await supabase
      .from("documents")
      .select("id, title, source, source_url, mime_type, word_count, is_active, uploaded_by, created_at, updated_at, metadata, audience, status, approved_by, approved_at, classification_updated_by, classification_updated_at, review_owner_user_id, review_due_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast({
        title: "Could not load documents",
        description: error.message,
        variant: "destructive",
      });
      setDocuments([]);
    } else if (data) {
      setDocuments(data as Document[]);
    }
    setLoading(false);
  }

  async function callDocumentAdmin(body: Record<string, unknown>): Promise<Document | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/document-admin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as { error?: string; document?: Document };
    if (!response.ok) {
      throw new Error(payload.error ?? "Document update failed");
    }
    return payload.document ?? null;
  }

  async function reindexDocument(doc: Document): Promise<void> {
    setReindexingId(doc.id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ document_id: doc.id }),
        }
      );

      const result = (await response.json()) as { chunks?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Re-index failed");

      toast({
        title: "Re-indexed",
        description: `"${doc.title}" re-indexed with ${result.chunks} chunks.`,
      });
      await loadDocuments();
    } catch (err) {
      toast({
        title: "Re-index failed",
        description: err instanceof Error ? err.message : "Re-index failed",
        variant: "destructive",
      });
    } finally {
      setReindexingId(null);
    }
  }

  async function uploadFile(file: File): Promise<void> {
    const validationError = validateKnowledgeBaseFile(file);
    if (validationError) {
      toast({
        title: "Upload blocked",
        description: validationError,
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStage("uploading");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name.replace(/\.[^.]+$/, ""));
      if (userRole === "admin" || userRole === "owner") {
        formData.append("audience", uploadAudience);
        formData.append("status", uploadStatus);
      }

      const result = await new Promise<{ chunks?: number; error?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest`);
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
        xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_ANON_KEY);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 70));
          }
        };

        xhr.upload.onload = () => {
          setUploadStage("processing");
          setUploadProgress(75);
          const tick = setInterval(() => {
            setUploadProgress((p) => Math.min(p + 2, 95));
          }, 800);
          xhr.addEventListener("load", () => clearInterval(tick), { once: true });
        };

        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(data);
            else reject(new Error(data.error ?? "Upload failed"));
          } catch {
            reject(new Error("Upload failed"));
          }
        };

        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(formData);
      });

      setUploadStage("done");
      setUploadProgress(100);
      toast({
        title: "Document uploaded",
        description:
          userRole === "manager"
            ? `"${file.name}" uploaded for admin review.`
            : `Indexed ${result.chunks} chunks from "${file.name}"`,
      });
      await loadDocuments();
    } catch (err) {
      setUploadProgress(0);
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Upload failed",
        variant: "destructive",
      });
    } finally {
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
        setUploadStage("uploading");
      }, 600);
    }
  }

  async function updateDocumentGovernance(
    doc: Document,
    updates: {
      audience?: DocumentAudience;
      status?: DocumentStatus;
      reviewDueAt?: string | null;
      reviewOwnerUserId?: string | null;
    }
  ): Promise<boolean> {
    try {
      const updated = await callDocumentAdmin({
        action: "update",
        documentId: doc.id,
        audience: updates.audience,
        status: updates.status,
        reviewDueAt: updates.reviewDueAt,
        reviewOwnerUserId: updates.reviewOwnerUserId,
      });
      if (updated) {
        setDocuments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        await loadDocuments();
      }
      return true;
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Document update failed",
        variant: "destructive",
      });
      return false;
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    try {
      await callDocumentAdmin({ action: "delete", documentId: id });
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      toast({ title: "Document deleted" });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Could not delete document",
        variant: "destructive",
      });
    }
  }

  function openGovernanceEditor(doc: Document): void {
    setEditTarget(doc);
    setEditAudience((doc.audience as DocumentAudience | null) ?? "company_wide");
    setEditStatus((doc.status as DocumentStatus | null) ?? "draft");
    setEditReviewDueAt(doc.review_due_at ? doc.review_due_at.slice(0, 10) : "");
    setEditReviewOwnerUserId(doc.review_owner_user_id ?? "");
  }

  async function saveGovernanceEditor(): Promise<void> {
    if (!editTarget) return;
    const target = editTarget;
    const ok = await updateDocumentGovernance(target, {
      audience: editAudience,
      status: editStatus,
      reviewDueAt: editReviewDueAt || null,
      reviewOwnerUserId: editReviewOwnerUserId || null,
    });
    if (ok) {
      toast({ title: "Document access updated" });
      setEditTarget(null);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Administration</h1>
        <p className="text-muted-foreground mt-1">{ROLE_SUBTITLES[userRole]}</p>
      </div>

      <Tabs defaultValue="knowledge">
        <TabsList className="mb-6 bg-transparent p-0 border-b border-border rounded-none h-auto w-full justify-start gap-0">
          <TabsTrigger
            value="knowledge"
            className="rounded-none px-4 pb-3 pt-1 text-sm data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary -mb-px"
          >
            Knowledge Base
          </TabsTrigger>
          <TabsTrigger
            value="users"
            className="rounded-none px-4 pb-3 pt-1 text-sm data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary -mb-px"
          >
            Team Members
          </TabsTrigger>
          <TabsTrigger
            value="knowledge-gaps"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
          >
            Knowledge Gaps
          </TabsTrigger>
          <TabsTrigger
            value="chat-insights"
            className="rounded-none px-4 pb-3 pt-1 text-sm data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary -mb-px"
          >
            Chat Insights
          </TabsTrigger>
          <TabsTrigger
            value="crm-tools"
            className="rounded-none px-4 pb-3 pt-1 text-sm data-[state=active]:shadow-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary -mb-px"
          >
            CRM Tools
          </TabsTrigger>
        </TabsList>

        <TabsContent value="knowledge" className="space-y-6">
          {canManageDocs && (
            <>
              <Card>
                <CardContent className="pt-6">
                  <div
                    onClick={() => !uploading && fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const { files } = e.dataTransfer;
                      if (files.length > 1) {
                        toast({
                          title: "Upload blocked",
                          description: "Upload one document at a time.",
                          variant: "destructive",
                        });
                        return;
                      }
                      const file = files[0];
                      if (file) void uploadFile(file);
                    }}
                    className={cn(
                      "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                      uploading
                        ? "cursor-not-allowed border-muted"
                        : "cursor-pointer hover:border-primary/50",
                      dragOver
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25"
                    )}
                  >
                    <Upload
                      className={cn(
                        "w-8 h-8 mx-auto mb-3",
                        uploading ? "text-primary animate-pulse" : "text-muted-foreground"
                      )}
                    />
                    <p className="text-sm font-medium text-foreground mb-1">
                      {uploading ? "Processing document…" : "Drag & drop or click to upload"}
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Upload one document at a time up to {MAX_UPLOAD_SIZE_LABEL}
                    </p>
                    {!uploading && (
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:justify-center">
                        {(userRole === "admin" || userRole === "owner") ? (
                          <>
                            <label className="text-left">
                              <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                                Audience
                              </span>
                              <select
                                value={uploadAudience}
                                onChange={(e) => setUploadAudience(e.target.value as DocumentAudience)}
                                onClick={(e) => e.stopPropagation()}
                                className="min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                              >
                                {DOCUMENT_AUDIENCE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-left">
                              <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
                                Initial Status
                              </span>
                              <select
                                value={uploadStatus}
                                onChange={(e) => setUploadStatus(e.target.value as "draft" | "published")}
                                onClick={(e) => e.stopPropagation()}
                                className="min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                              >
                                <option value="published">Published</option>
                                <option value="draft">Draft</option>
                              </select>
                            </label>
                          </>
                        ) : (
                          <div className="rounded-md border border-border bg-background px-3 py-2 text-left text-xs text-muted-foreground">
                            Manager uploads are always company-wide and go to pending review until an admin or owner publishes them.
                          </div>
                        )}
                      </div>
                    )}
                    {uploading ? (
                      <div className="w-full max-w-xs mx-auto">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {uploadStage === "uploading" && `Uploading... ${Math.round(uploadProgress)}%`}
                          {uploadStage === "processing" && "Processing — parsing, chunking, embedding..."}
                          {uploadStage === "done" && "Complete!"}
                        </p>
                      </div>
                    ) : (
                      <div className="flex justify-center gap-2 flex-wrap">
                        {SUPPORTED_UPLOAD_EXTENSIONS.map((ext) => (
                          <Badge key={ext} variant="secondary" className="text-xs">
                            {ext}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={SUPPORTED_UPLOAD_ACCEPT}
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadFile(file);
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-1">
                        Integration Hub
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Manage OneDrive, HubSpot, communication providers, and other external systems from one place.
                      </p>
                    </div>
                    <Button size="sm" asChild>
                      <a href="/admin/integrations">
                        <Cloud className="w-4 h-4 mr-2" />
                        Open Integration Hub
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
              <div className="flex items-center gap-2 flex-1">
                <h2 className="text-base font-semibold text-foreground">Knowledge Base</h2>
                <Badge variant="secondary" className="text-xs">
                  {documents.filter((d) => d.status === "published").length} published
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {documents.filter((d) => d.status === "pending_review").length} pending review
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search docs…"
                    value={docSearch}
                    onChange={(e) => setDocSearch(e.target.value)}
                    className="pl-8 pr-7 py-1.5 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-qep-orange/50 w-40"
                  />
                  {docSearch && (
                    <button
                      onClick={() => setDocSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="flex gap-1">
                  {DOCUMENT_FILTERS.map((f) => (
                    <button
                      key={f}
                      onClick={() => setDocFilter(f)}
                      className={cn(
                        "px-2.5 py-1 text-xs rounded-md font-medium transition-colors capitalize",
                        docFilter === f
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {(() => {
              const filtered = documents.filter((d) => {
                const matchesFilter =
                  docFilter === "all" ||
                  d.status === docFilter;
                const matchesSearch =
                  !docSearch ||
                  d.title.toLowerCase().includes(docSearch.toLowerCase());
                return matchesFilter && matchesSearch;
              });

              if (loading) {
                return (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-12 bg-muted rounded-md animate-pulse" />
                    ))}
                  </div>
                );
              }

              if (documents.length === 0) {
                return (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No documents yet. Upload your first document above.
                      </p>
                    </CardContent>
                  </Card>
                );
              }

              if (filtered.length === 0) {
                return (
                  <Card>
                    <CardContent className="py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        No documents match your search.
                      </p>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <>
                  {documents.some((doc) => doc.status === "pending_review") && (
                    <Card className="mb-4">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-foreground">Review Queue</h3>
                            <p className="text-sm text-muted-foreground">
                              {documents.filter((doc) => doc.status === "pending_review").length} document(s) waiting for publish review.
                            </p>
                          </div>
                          {canReviewDocs && (
                            <Button size="sm" variant="outline" onClick={() => setDocFilter("pending_review")}>
                              Show pending review
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Mobile stacked cards — shown below md */}
                  <div className="md:hidden space-y-2">
                    {filtered.map((doc) => (
                      <Card key={doc.id}>
                        <CardContent className="py-3 px-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm truncate">{doc.title}</p>
                              <p className="text-xs text-muted-foreground capitalize mt-0.5">
                                {doc.source.replace("_", " ")}
                                {doc.word_count ? ` · ${doc.word_count.toLocaleString()} words` : ""}
                              </p>
                              {(doc as any).summary && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">
                                  {(doc as any).summary}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <Badge variant="outline" className="text-[10px]">
                                  {formatAudienceLabel(doc.audience as DocumentAudience)}
                                </Badge>
                                <Badge variant={doc.status === "published" ? "default" : "secondary"}>
                                  {formatStatusLabel(doc.status as DocumentStatus)}
                                </Badge>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {canManageDocs && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Document actions">
                                      <MoreVertical className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      disabled={reindexingId === doc.id}
                                      onClick={() => void reindexDocument(doc)}
                                    >
                                      <RefreshCw className={cn("w-4 h-4 mr-2", reindexingId === doc.id && "animate-spin")} />
                                      Re-index
                                    </DropdownMenuItem>
                                    {canReviewDocs && (
                                      <>
                                        {doc.status !== "published" && (
                                          <DropdownMenuItem onClick={() => void updateDocumentGovernance(doc, { status: "published" })}>
                                            <ToggleRight className="w-4 h-4 mr-2 text-primary" />
                                            Publish
                                          </DropdownMenuItem>
                                        )}
                                        {doc.status !== "archived" && (
                                          <DropdownMenuItem onClick={() => void updateDocumentGovernance(doc, { status: "archived" })}>
                                            <ToggleLeft className="w-4 h-4 mr-2" />
                                            Archive
                                          </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem onClick={() => openGovernanceEditor(doc)}>
                                          Edit Access
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-destructive focus:text-destructive"
                                          onClick={() => setDeleteTarget(doc)}
                                        >
                                          <Trash2 className="w-4 h-4 mr-2" />
                                          Delete
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Desktop table — shown at md+ */}
                  <Card className="hidden md:block overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>Audience</TableHead>
                          <TableHead className="hidden lg:table-cell">Words</TableHead>
                          <TableHead>Status</TableHead>
                          {canManageDocs && (
                            <TableHead className="text-right w-12">Actions</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((doc) => (
                          <TableRow key={doc.id}>
                            <TableCell className="font-medium max-w-48 truncate">
                              {doc.title}
                            </TableCell>
                            <TableCell className="text-muted-foreground capitalize">
                              {doc.source.replace("_", " ")}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {formatAudienceLabel(doc.audience as DocumentAudience)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground hidden lg:table-cell">
                              {doc.word_count?.toLocaleString() ?? "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={doc.status === "published" ? "default" : "secondary"}>
                                {formatStatusLabel(doc.status as DocumentStatus)}
                              </Badge>
                            </TableCell>
                            {canManageDocs && (
                              <TableCell className="text-right">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Document actions">
                                      <MoreVertical className="w-4 h-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      disabled={reindexingId === doc.id}
                                      onClick={() => void reindexDocument(doc)}
                                    >
                                      <RefreshCw className={cn("w-4 h-4 mr-2", reindexingId === doc.id && "animate-spin")} />
                                      Re-index
                                    </DropdownMenuItem>
                                    {canReviewDocs && (
                                      <>
                                        {doc.status !== "published" && (
                                          <DropdownMenuItem onClick={() => void updateDocumentGovernance(doc, { status: "published" })}>
                                            <ToggleRight className="w-4 h-4 mr-2 text-primary" />
                                            Publish
                                          </DropdownMenuItem>
                                        )}
                                        {doc.status !== "archived" && (
                                          <DropdownMenuItem onClick={() => void updateDocumentGovernance(doc, { status: "archived" })}>
                                            <ToggleLeft className="w-4 h-4 mr-2" />
                                            Archive
                                          </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem onClick={() => openGovernanceEditor(doc)}>
                                          Edit Access
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-destructive focus:text-destructive"
                                          onClick={() => setDeleteTarget(doc)}
                                        >
                                          <Trash2 className="w-4 h-4 mr-2" />
                                          Delete
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                </>
              );
            })()}
          </div>
        </TabsContent>

        <TabsContent value="users">
          <UsersTab callerRole={userRole} callerId={userId} />
        </TabsContent>

        <TabsContent value="knowledge-gaps">
          <KnowledgeGapsPanel />
        </TabsContent>

        <TabsContent value="chat-insights">
          <ChatInsightsPanel />
        </TabsContent>

        <TabsContent value="crm-tools">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Manage follow-up automation, activity templates, and data quality tools.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Sequences", description: "Automated follow-up sequences that keep deals moving.", href: "/admin/sequences", icon: NotebookPen },
                { label: "Templates", description: "Activity and email templates for reps.", href: "/admin/templates", icon: NotebookPen },
                { label: "Duplicates", description: "Find and merge duplicate contact records.", href: "/admin/duplicates", icon: GitMerge },
              ].map((tool) => (
                <Link key={tool.href} to={tool.href} className="group">
                  <Card className="flex items-center gap-4 border-border px-5 py-4 transition-shadow duration-150 group-hover:shadow-md min-h-[72px]">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <tool.icon className="h-5 w-5 text-primary" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{tool.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{tool.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit document access</DialogTitle>
            <DialogDescription>
              Audience, publication status, and review routing for &ldquo;{editTarget?.title}&rdquo;.
            </DialogDescription>
          </DialogHeader>
          {editTarget && canReviewDocs && (
            <div className="grid gap-4 py-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Audience
                </span>
                <select
                  value={editAudience}
                  onChange={(e) => setEditAudience(e.target.value as DocumentAudience)}
                  className="min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  {DOCUMENT_AUDIENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </span>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as DocumentStatus)}
                  className="min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  {DOCUMENT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Review due date
                </span>
                <input
                  type="date"
                  value={editReviewDueAt}
                  onChange={(e) => setEditReviewDueAt(e.target.value)}
                  className="min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Review owner
                </span>
                <select
                  value={editReviewOwnerUserId}
                  onChange={(e) => setEditReviewOwnerUserId(e.target.value)}
                  className="min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Unassigned</option>
                  {reviewAssignees.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name?.trim() || p.email || p.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveGovernanceEditor()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete document?</DialogTitle>
            <DialogDescription>
              This will permanently delete &ldquo;{deleteTarget?.title}&rdquo; and all its
              indexed chunks. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
