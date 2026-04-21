import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const DOCUMENT_AUDIENCES = [
  { value: "company_wide", label: "Company-wide", hint: "All authenticated roles" },
  { value: "finance", label: "Finance", hint: "Finance leads and above" },
  { value: "leadership", label: "Leadership", hint: "Manager, admin, owner" },
  { value: "admin_owner", label: "Admin + Owner", hint: "Admin and owner only" },
  { value: "owner_only", label: "Owner-only", hint: "Owner role only" },
] as const;

export type DocumentAudience = (typeof DOCUMENT_AUDIENCES)[number]["value"];

export interface FolderCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentFolderName: string | null;
  onSubmit: (input: { name: string; audience: DocumentAudience }) => Promise<void>;
}

export function FolderCreateDialog({
  open,
  onOpenChange,
  parentFolderName,
  onSubmit,
}: FolderCreateDialogProps) {
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<DocumentAudience>("company_wide");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setAudience("company_wide");
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = name.trim().length > 0 && !submitting;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), audience });
      onOpenChange(false);
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              {parentFolderName
                ? `Creates a subfolder inside ${parentFolderName}.`
                : "Creates a top-level folder at the root."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rental agreements — 2026"
              autoComplete="off"
              maxLength={200}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="folder-audience">Audience</Label>
            <Select
              value={audience}
              onValueChange={(value) => setAudience(value as DocumentAudience)}
            >
              <SelectTrigger id="folder-audience">
                <SelectValue placeholder="Choose audience" />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_AUDIENCES.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    <div className="flex flex-col">
                      <span>{entry.label}</span>
                      <span className="text-[11px] text-muted-foreground">{entry.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Controls who can see documents filed in this folder. Narrower audiences hide the folder from
              lower roles entirely.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
