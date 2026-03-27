import { useState, useEffect, useRef } from "react";
import { Upload, FileText, Trash2, ToggleLeft, ToggleRight, Cloud } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Document = Database["public"]["Tables"]["documents"]["Row"];

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

export function AdminPage({ userRole, userId }: AdminPageProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);

  const canManageDocs = ["admin", "manager", "owner"].includes(userRole);

  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments(): Promise<void> {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setDocuments(data);
    setLoading(false);
  }

  async function uploadFile(file: File): Promise<void> {
    setUploading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", file.name.replace(/\.[^.]+$/, ""));

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: formData,
        }
      );

      const result = (await response.json()) as { chunks?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Upload failed");

      toast({
        title: "Document uploaded",
        description: `Indexed ${result.chunks} chunks from "${file.name}"`,
      });
      await loadDocuments();
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Upload failed",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function toggleDocument(doc: Document): Promise<void> {
    await supabase
      .from("documents")
      .update({ is_active: !doc.is_active })
      .eq("id", doc.id);
    setDocuments((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, is_active: !doc.is_active } : d))
    );
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    await supabase.from("documents").delete().eq("id", deleteTarget.id);
    setDocuments((prev) => prev.filter((d) => d.id !== deleteTarget.id));
    toast({ title: "Document deleted" });
    setDeleteTarget(null);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Administration</h1>
        <p className="text-muted-foreground mt-1">{ROLE_SUBTITLES[userRole]}</p>
      </div>

      <Tabs defaultValue="knowledge">
        <TabsList className="mb-6">
          <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
          <TabsTrigger value="users">Team Members</TabsTrigger>
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
                      const file = e.dataTransfer.files[0];
                      if (file) void uploadFile(file);
                    }}
                    className={cn(
                      "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                      uploading
                        ? "cursor-not-allowed border-muted"
                        : "cursor-pointer hover:border-primary/50",
                      dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
                    )}
                  >
                    <Upload
                      className={cn(
                        "w-8 h-8 mx-auto mb-3 text-muted-foreground",
                        uploading && "animate-pulse"
                      )}
                    />
                    <p className="text-sm font-medium text-foreground mb-1">
                      {uploading ? "Processing document…" : "Drag & drop or click to upload"}
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Company handbooks, SOPs, and policy documents
                    </p>
                    <div className="flex justify-center gap-2">
                      {[".txt", ".md", ".csv"].map((ext) => (
                        <Badge key={ext} variant="secondary" className="text-xs">
                          {ext}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.csv"
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
                        OneDrive Integration
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Automatically sync company documents from your Microsoft 365 account.
                      </p>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${import.meta.env.VITE_MSGRAPH_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(window.location.origin + "/auth/onedrive/callback")}&scope=files.read.all+offline_access&response_mode=query`}
                      >
                        <Cloud className="w-4 h-4 mr-2" />
                        Connect OneDrive
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-semibold text-foreground">Knowledge Base</h2>
              <Badge variant="secondary" className="text-xs">
                {documents.filter((d) => d.is_active).length} active
              </Badge>
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-12 bg-muted rounded-md animate-pulse" />
                ))}
              </div>
            ) : documents.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No documents yet. Upload your first document above.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="hidden md:table-cell">Words</TableHead>
                      <TableHead>Status</TableHead>
                      {canManageDocs && (
                        <TableHead className="text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium max-w-48 truncate">
                          {doc.title}
                        </TableCell>
                        <TableCell className="text-muted-foreground capitalize">
                          {doc.source.replace("_", " ")}
                        </TableCell>
                        <TableCell className="text-muted-foreground hidden md:table-cell">
                          {doc.word_count?.toLocaleString() ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={doc.is_active ? "default" : "secondary"}>
                            {doc.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        {canManageDocs && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void toggleDocument(doc)}
                                className="h-7 px-2 text-xs"
                              >
                                {doc.is_active ? (
                                  <ToggleRight className="w-4 h-4 mr-1 text-primary" />
                                ) : (
                                  <ToggleLeft className="w-4 h-4 mr-1" />
                                )}
                                {doc.is_active ? "Disable" : "Enable"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteTarget(doc)}
                                className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="w-4 h-4 mr-1" />
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="users">
          <UsersTab callerRole={userRole} callerId={userId} />
        </TabsContent>
      </Tabs>

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
