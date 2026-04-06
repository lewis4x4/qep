import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";

interface Props {
  branchSlug: string;
  currentUrl: string | null;
  onUploaded: (publicUrl: string) => void;
  onRemoved?: () => void;
}

const BUCKET = "branch-assets";
const MAX_SIZE = 5 * 1024 * 1024;
const ACCEPTED = ".jpg,.jpeg,.png,.webp,.svg";

export function BranchLogoUpload({ branchSlug, currentUrl, onUploaded, onRemoved }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size > MAX_SIZE) {
        setError("File too large (max 5 MB)");
        return;
      }
      if (!file.type.startsWith("image/")) {
        setError("Only image files accepted");
        return;
      }
      setUploading(true);
      try {
        const ext = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "png";
        const path = `logos/${branchSlug}/logo.${ext}`;

        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        if (pub?.publicUrl) {
          const cacheBuster = `?v=${Date.now()}`;
          onUploaded(pub.publicUrl + cacheBuster);
        }
      } catch (e) {
        setError((e as Error).message ?? "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [branchSlug, onUploaded],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) upload(file);
    },
    [upload],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = () => {
    onRemoved?.();
  };

  return (
    <div className="space-y-2">
      <label className="text-[11px] text-muted-foreground block">Branch logo</label>

      {currentUrl ? (
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-32 rounded border bg-muted/30 flex items-center justify-center overflow-hidden">
            <img
              src={currentUrl}
              alt="Branch logo"
              className="max-h-full max-w-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive gap-1"
              onClick={remove}
            >
              <X className="h-3 w-3" />
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-6 cursor-pointer transition
            ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          )}
          <p className="text-xs text-muted-foreground text-center">
            {uploading ? "Uploading..." : "Drag & drop logo or click to browse"}
          </p>
          <p className="text-[10px] text-muted-foreground">PNG, JPG, WebP, or SVG — max 5 MB</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={handleFileChange}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
