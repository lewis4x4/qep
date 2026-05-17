import type { Dispatch, ReactNode, SetStateAction } from "react";
import { FileDown, Link2, Loader2, Mail, Printer, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { money } from "../lib/money";
import type { QuotePacketReadiness, QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import { ReadinessRow } from "./ReadinessRow";
import { SendQuoteSection } from "./SendQuoteSection";
// WAVE polish (Slice 2): voice dictation on the internal-notes textarea.
// Slice 6 will wrap the Dialog itself in a MobileBottomSheet on phone.
import { MobileVoiceTextarea } from "@/features/sales/components/MobileVoiceTextarea";

export interface ReviewSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: QuoteWorkspaceDraft;
  setDraft: Dispatch<SetStateAction<QuoteWorkspaceDraft>>;
  customerTotal: number;
  financeMethodLabel: string;
  pdfGenerating: boolean;
  pdfError: string | null;
  onDownloadPdf: () => void;
  shareBusy: boolean;
  shareUrl: string | null;
  shareError: string | null;
  onIssueShareLink: () => void;
  activeQuotePackageId: string | null;
  internalNotes: string;
  setInternalNotes: Dispatch<SetStateAction<string>>;
  packetReadiness: QuotePacketReadiness;
  approvalGranted: boolean;
  requiresManagerApproval: boolean;
  approvalDetail: string;
  onSent: () => void;
}

function DeliveryOption({
  icon,
  label,
  active,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        disabled
          ? "border-border/60 bg-muted/20 text-muted-foreground"
          : active
            ? "border-qep-orange/30 bg-qep-orange/5 text-foreground"
            : "border-border bg-card/40 text-muted-foreground"
      }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium">{label}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {disabled ? "Backend gap" : "Available"}
      </p>
    </div>
  );
}

export function ReviewSendDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  customerTotal,
  financeMethodLabel,
  pdfGenerating,
  pdfError,
  onDownloadPdf,
  shareBusy,
  shareUrl,
  shareError,
  onIssueShareLink,
  activeQuotePackageId,
  internalNotes,
  setInternalNotes,
  packetReadiness,
  approvalGranted,
  requiresManagerApproval,
  approvalDetail,
  onSent,
}: ReviewSendDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review & Send</DialogTitle>
          <DialogDescription>
            Confirm the customer packet, choose delivery, and send without leaving the workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">PDF preview</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {draft.customerCompany || draft.customerName || "Customer proposal"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {draft.equipment.length} equipment line{draft.equipment.length === 1 ? "" : "s"}
                    {" · "}
                    {draft.attachments.length} commercial add-on{draft.attachments.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-kpi text-2xl font-extrabold tabular-nums text-qep-orange">{money(customerTotal)}</p>
                  <p className="text-[11px] text-muted-foreground">{financeMethodLabel}</p>
                </div>
              </div>

              <div className="mt-4 space-y-2 rounded-lg border border-border/70 bg-background/50 p-3">
                {[...draft.equipment, ...draft.attachments].slice(0, 6).map((line, index) => (
                  <div key={`${line.title}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted-foreground">
                      {line.title || `${line.make ?? ""} ${line.model ?? ""}`.trim()}
                    </span>
                    <span className="font-medium text-foreground">{money(line.unitPrice * line.quantity)}</span>
                  </div>
                ))}
                <div className="border-t border-border/70 pt-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-foreground">Customer total</span>
                    <span className="font-semibold text-qep-orange">{money(customerTotal)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" onClick={onDownloadPdf} disabled={pdfGenerating}>
                  {pdfGenerating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}
                  PDF
                </Button>
                <Button variant="outline" onClick={onDownloadPdf} disabled={pdfGenerating}>
                  <Printer className="mr-1 h-4 w-4" /> Print
                </Button>
                <Button variant="outline" onClick={onIssueShareLink} disabled={!activeQuotePackageId || shareBusy}>
                  {shareBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Link2 className="mr-1 h-4 w-4" />}
                  Copy Link
                </Button>
              </div>
              {shareUrl && (
                <p className="mt-2 break-all rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
                  Copied link: {shareUrl}
                </p>
              )}
              {shareError && <p className="mt-2 text-xs text-rose-400">{shareError}</p>}
              {pdfError && <p className="mt-2 text-xs text-rose-400">{pdfError}</p>}
            </Card>

            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Delivery options</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <DeliveryOption icon={<Mail className="h-4 w-4" />} label="Email" active />
                <DeliveryOption icon={<Smartphone className="h-4 w-4" />} label="SMS" disabled />
                <DeliveryOption icon={<Printer className="h-4 w-4" />} label="Print" active />
                <DeliveryOption icon={<Link2 className="h-4 w-4" />} label="Link" active />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Recipient</span>
                  <input
                    value={draft.customerName || draft.customerCompany || ""}
                    onChange={(event) => setDraft((current) => ({ ...current, customerName: event.target.value }))}
                    className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Email</span>
                  <input
                    value={draft.customerEmail ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, customerEmail: event.target.value }))}
                    className="w-full rounded border border-input bg-card px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <label className="mt-4 block space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Internal notes</span>
                <MobileVoiceTextarea
                  value={internalNotes}
                  onChange={(event) => setInternalNotes(event.target.value)}
                  placeholder="Private note for follow-up, manager context, or delivery caveats."
                  className="min-h-[90px] w-full rounded border border-input bg-card px-3 py-2 text-base sm:text-sm"
                />
              </label>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Readiness</p>
              <div className="mt-3 space-y-2 text-sm">
                <ReadinessRow label="Draft" ready={packetReadiness.draft.ready} detail={packetReadiness.draft.missing.join(", ")} />
                <ReadinessRow label="Send" ready={packetReadiness.send.ready} detail={packetReadiness.send.missing.join(", ")} />
                <ReadinessRow
                  label="Approval"
                  ready={approvalGranted || !requiresManagerApproval}
                  detail={approvalDetail}
                />
              </div>
            </Card>

            {activeQuotePackageId ? (
              <SendQuoteSection
                quotePackageId={activeQuotePackageId}
                contactName={draft.customerName || draft.customerCompany || "customer"}
                onSent={onSent}
              />
            ) : (
              <Card className="border-amber-500/20 bg-amber-500/5 p-4">
                <p className="text-sm font-medium text-amber-400">Save before sending</p>
                <p className="mt-1 text-xs text-amber-300">
                  A quote package id is required for email and share-link delivery.
                </p>
              </Card>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
