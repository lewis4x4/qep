import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import type { Database, UserRole } from "../lib/database.types";

type Document = Database["public"]["Tables"]["documents"]["Row"];

interface AdminPageProps {
  userRole: UserRole;
}

export function AdminPage({ userRole }: AdminPageProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const canManageDocs = ["admin", "manager", "owner"].includes(userRole);
  const canManageUsers = userRole === "owner";

  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments() {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setDocuments(data);
    setLoading(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
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

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload failed");

      setUploadSuccess(`Uploaded and indexed ${result.chunks} chunks from "${file.name}"`);
      await loadDocuments();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function toggleDocument(id: string, isActive: boolean) {
    await supabase.from("documents").update({ is_active: !isActive }).eq("id", id);
    setDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, is_active: !isActive } : d))
    );
  }

  async function deleteDocument(id: string) {
    if (!confirm("Delete this document and all its chunks?")) return;
    await supabase.from("documents").delete().eq("id", id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold">Q</span>
          </div>
          <h1 className="text-sm font-semibold text-gray-900">QEP Admin Panel</h1>
        </div>
        <div className="flex gap-3 items-center">
          <a href="/" className="text-xs text-blue-600 hover:underline">Chat</a>
          {["manager", "owner"].includes(userRole) && (
            <a href="/quote" className="text-xs text-green-600 hover:underline">Quote</a>
          )}
          <a href="/voice" className="text-xs text-orange-500 hover:underline">Field Note</a>
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Document Upload */}
        {canManageDocs && (
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-3">Upload Document</h2>
            <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-6 text-center">
              <p className="text-sm text-gray-500 mb-3">Upload company handbook, SOPs, or policy documents (.txt, .md files)</p>
              <label className="cursor-pointer">
                <span className={`inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition ${uploading ? "opacity-50 cursor-not-allowed" : ""}`}>
                  {uploading ? "Processing..." : "Choose File"}
                </span>
                <input
                  type="file"
                  accept=".txt,.md,.csv"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
              {uploadError && <p className="text-red-600 text-sm mt-3">{uploadError}</p>}
              {uploadSuccess && <p className="text-green-600 text-sm mt-3">{uploadSuccess}</p>}
            </div>
          </section>
        )}

        {/* OneDrive Connect */}
        {canManageDocs && (
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-3">OneDrive Integration</h2>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <p className="text-sm text-gray-600 mb-4">
                Connect OneDrive to automatically sync company documents from your Microsoft 365 account.
              </p>
              <a
                href={`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${import.meta.env.VITE_MSGRAPH_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(window.location.origin + "/auth/onedrive/callback")}&scope=files.read.all+offline_access&response_mode=query`}
                className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-100 transition"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Connect Microsoft OneDrive
              </a>
            </div>
          </section>
        )}

        {/* Documents List */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-3">Knowledge Base ({documents.filter(d => d.is_active).length} active documents)</h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : documents.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
              <p className="text-gray-500 text-sm">No documents yet. Upload your first document above.</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Words</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    {canManageDocs && (
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900 truncate max-w-48">{doc.title}</td>
                      <td className="px-4 py-3 text-gray-500 capitalize">{doc.source.replace("_", " ")}</td>
                      <td className="px-4 py-3 text-gray-500">{doc.word_count?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          doc.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}>
                          {doc.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      {canManageDocs && (
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => toggleDocument(doc.id, doc.is_active)}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              {doc.is_active ? "Disable" : "Enable"}
                            </button>
                            <button
                              onClick={() => deleteDocument(doc.id)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
