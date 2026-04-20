import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createCrmContactViaRouter,
  createCrmCompanyViaRouter,
} from "@/features/qrm/lib/qrm-router-api";

/**
 * Slice 11 CP2 — One-click "Add to QRM" from the AI Request Log.
 *
 * When the AI couldn't resolve a request (yellow "Unresolved" badge), the
 * admin can capture it as a CRM lead instead of letting the intent evaporate.
 * This dialog opens with the raw prompt as read-only context + 3 input fields
 * (first name, last name, optional company) — enough to seed a followable lead
 * without forcing the admin through the full contact editor experience.
 *
 * On save:
 *   - Optionally creates a company (if a name was typed and no existing
 *     primaryCompanyId is known).
 *   - Creates the contact via `createCrmContactViaRouter`, with the raw
 *     prompt truncated into the `title` field so the rep sees what the
 *     request was about when they follow up.
 *   - Fires a success toast and closes the dialog.
 */

const TITLE_MAX = 180;

export interface AddToCrmLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The AI log row being captured — used for context + prompt snippet. */
  context: {
    logId: string;
    rawPrompt: string | null;
    createdAt: string;
  } | null;
  onSaved?: () => void;
}

export function AddToCrmLeadDialog({
  open,
  onOpenChange,
  context,
  onSaved,
}: AddToCrmLeadDialogProps) {
  const { toast } = useToast();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [companyName, setCompanyName] = useState("");
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setCompanyName("");
      setSaving(false);
      setFormError(null);
    }
  }, [open]);

  const canSave = firstName.trim().length > 0 && lastName.trim().length > 0 && !saving;

  const truncatedPrompt =
    context?.rawPrompt && context.rawPrompt.length > 120
      ? context.rawPrompt.slice(0, 117) + "…"
      : (context?.rawPrompt ?? "");

  async function handleSave() {
    if (!canSave || !context) return;
    setSaving(true);
    setFormError(null);
    try {
      let primaryCompanyId: string | null = null;
      if (companyName.trim().length > 0) {
        const company = await createCrmCompanyViaRouter({
          name: companyName.trim().slice(0, 200),
        });
        primaryCompanyId = company.id ?? null;
      }

      const title = (context.rawPrompt ?? "")
        .trim()
        .slice(0, TITLE_MAX);

      await createCrmContactViaRouter({
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        title:     title.length > 0 ? title : null,
        primaryCompanyId,
      });

      toast({
        title: "Lead added to QRM",
        description: `Saved ${firstName.trim()} ${lastName.trim()} with the AI request as context.`,
      });
      onSaved?.();
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setFormError(`Could not save: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (saving ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to QRM</DialogTitle>
          <DialogDescription>
            Capture this unresolved AI request as a CRM lead so a rep can follow up.
          </DialogDescription>
        </DialogHeader>

        {context && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <div className="mb-1 font-medium text-muted-foreground">Original request</div>
            <div className="italic">{truncatedPrompt || "(no prompt recorded)"}</div>
          </div>
        )}

        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="addcrm-first">First name</Label>
              <Input
                id="addcrm-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={saving}
                placeholder="Jane"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="addcrm-last">Last name</Label>
              <Input
                id="addcrm-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={saving}
                placeholder="Smith"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="addcrm-company">Company (optional)</Label>
            <Input
              id="addcrm-company"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={saving}
              placeholder="Acme Construction"
            />
          </div>
        </div>

        {formError && (
          <p className="text-xs text-destructive">{formError}</p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
