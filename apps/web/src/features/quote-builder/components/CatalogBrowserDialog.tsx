import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CatalogAttachmentMatch, CatalogEntryMatch } from "../lib/quote-builder-page-helpers";
import { EquipmentSelector } from "./EquipmentSelector";

export interface CatalogBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectEquipment: (entry: CatalogEntryMatch) => void;
  onSelectAttachment: (entry: CatalogAttachmentMatch) => void;
  onRecommendation: (rec: { machine: string; attachments: string[]; reasoning: string }) => void;
}

export function CatalogBrowserDialog({
  open,
  onOpenChange,
  onSelectEquipment,
  onSelectAttachment,
  onRecommendation,
}: CatalogBrowserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Browse QEP catalog</DialogTitle>
          <DialogDescription>
            Pick equipment or parts from active QEP catalog records. AI text cannot become a quote line unless it resolves here.
          </DialogDescription>
        </DialogHeader>
        <EquipmentSelector
          onSelect={onSelectEquipment}
          onSelectAttachment={onSelectAttachment}
          onRecommendation={onRecommendation}
          autoLoad
          title="Find quote items"
          helper="Start broad with all active QEP catalog items, then narrow by make, model, category, tractor, attachment, blade, mower, or part name."
        />
      </DialogContent>
    </Dialog>
  );
}
