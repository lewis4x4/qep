/**
 * Post–PR 21 orchestrator slimming: modal overlays + deal assistant drawer
 * extracted from `QuoteBuilderV2Page.tsx`. Mechanical move.
 */

import type { Dispatch, SetStateAction } from "react";

import { CatalogBrowserDialog } from "./CatalogBrowserDialog";
import { ConversationalDealEngine } from "./ConversationalDealEngine";
import { PackageItemSearchDialog } from "./PackageItemSearchDialog";
import { ReviewSendDialog } from "./ReviewSendDialog";
import type { SendQuoteSectionResult } from "./SendQuoteSection";
import { TradeCaptureDialog } from "./TradeCaptureDialog";
import type { ScenarioSelection } from "./ConversationalDealEngine";
import type { CatalogAttachmentMatch, CatalogEntryMatch } from "../lib/quote-builder-page-helpers";
import type { QuotePackageCatalogItem, QuotePackageCatalogKind } from "../lib/quote-api";
import type { QuotePacketReadiness } from "../../../../../../shared/qep-moonshot-contracts";
import {
  type TradeCaptureDraft,
  type TradeChecklistKey,
} from "../lib/trade-checklist";
import { useWizard } from "../wizard/useWizard";

export interface QuoteBuilderOverlaysProps {
  dealAssistantOpen: boolean;
  onDealAssistantOpenChange: (open: boolean) => void;
  onScenarioSelect: (selection: ScenarioSelection) => void;
  activeQuotePackageId: string | null;

  tradeCaptureOpen: boolean;
  onTradeCaptureOpenChange: (open: boolean) => void;
  activeTradeCaptureKey: TradeChecklistKey;
  onActiveTradeCaptureKeyChange: (key: TradeChecklistKey) => void;
  tradeCapture: TradeCaptureDraft;
  setTradeCapture: Dispatch<SetStateAction<TradeCaptureDraft>>;
  tradeChecklist: Record<TradeChecklistKey, boolean>;

  packageItemSearchOpen: boolean;
  onPackageItemSearchOpenChange: (open: boolean) => void;
  configureTab: QuotePackageCatalogKind;
  availableOptions: Array<{ id: string; name: string; price: number }>;
  availableOptionsLabel: string | null;
  onAddPackageCatalogItem: (entry: QuotePackageCatalogItem) => void;

  catalogBrowserOpen: boolean;
  onCatalogBrowserOpenChange: (open: boolean) => void;
  onAddCatalogEquipment: (entry: CatalogEntryMatch) => void;
  onAddCatalogAttachment: (entry: CatalogAttachmentMatch) => void;

  reviewSendOpen: boolean;
  onReviewSendOpenChange: (open: boolean) => void;
  customerTotal: number;
  financeMethodLabel: string;
  pdfGenerating: boolean;
  pdfError: string | null;
  onDownloadPdf: () => void;
  shareBusy: boolean;
  shareUrl: string | null;
  shareError: string | null;
  onIssueShareLink: () => void;
  internalNotes: string;
  setInternalNotes: Dispatch<SetStateAction<string>>;
  packetReadiness: QuotePacketReadiness;
  approvalGranted: boolean;
  requiresManagerApproval: boolean;
  approvalDetail: string;
  onSendQuote?: () => Promise<SendQuoteSectionResult>;
}

export function QuoteBuilderOverlays({
  dealAssistantOpen,
  onDealAssistantOpenChange,
  onScenarioSelect,
  activeQuotePackageId,
  tradeCaptureOpen,
  onTradeCaptureOpenChange,
  activeTradeCaptureKey,
  onActiveTradeCaptureKeyChange,
  tradeCapture,
  setTradeCapture,
  tradeChecklist,
  packageItemSearchOpen,
  onPackageItemSearchOpenChange,
  configureTab,
  availableOptions,
  availableOptionsLabel,
  onAddPackageCatalogItem,
  catalogBrowserOpen,
  onCatalogBrowserOpenChange,
  onAddCatalogEquipment,
  onAddCatalogAttachment,
  reviewSendOpen,
  onReviewSendOpenChange,
  customerTotal,
  financeMethodLabel,
  pdfGenerating,
  pdfError,
  onDownloadPdf,
  shareBusy,
  shareUrl,
  shareError,
  onIssueShareLink,
  internalNotes,
  setInternalNotes,
  packetReadiness,
  approvalGranted,
  requiresManagerApproval,
  approvalDetail,
  onSendQuote,
}: QuoteBuilderOverlaysProps) {
  const { draft, setDraft, setStep } = useWizard();

  return (
    <>
      <ConversationalDealEngine
        open={dealAssistantOpen}
        onClose={() => onDealAssistantOpenChange(false)}
        onScenarioSelect={onScenarioSelect}
        dealId={draft.dealId || undefined}
        quotePackageId={activeQuotePackageId ?? undefined}
        quoteName={draft.customerName || draft.customerCompany || undefined}
        onCopilotDraftPatch={(patch) => {
          setDraft((current) => ({
            ...current,
            ...patch,
            customerSignals: patch.customerSignals
              ? {
                  ...(current.customerSignals ?? {
                    openDeals: 0,
                    openDealValueCents: 0,
                    lastContactDaysAgo: null,
                    pastQuoteCount: 0,
                    pastQuoteValueCents: 0,
                  }),
                  ...patch.customerSignals,
                }
              : current.customerSignals,
          }));
        }}
        onCopilotScore={() => {
          // WinProbabilityStrip recomputes from patched draft.
        }}
      />

      <TradeCaptureDialog
        open={tradeCaptureOpen}
        onOpenChange={onTradeCaptureOpenChange}
        activeTradeCaptureKey={activeTradeCaptureKey}
        onActiveTradeCaptureKeyChange={onActiveTradeCaptureKeyChange}
        tradeCapture={tradeCapture}
        setTradeCapture={setTradeCapture}
        tradeChecklist={tradeChecklist}
      />

      <PackageItemSearchDialog
        open={packageItemSearchOpen}
        onOpenChange={onPackageItemSearchOpenChange}
        kind={configureTab}
        selectedIds={draft.attachments
          .filter((item) => item.kind === configureTab)
          .flatMap((item) => [item.id, item.sourceId].filter((value): value is string => Boolean(value)))}
        compatibleItems={availableOptions.map((item) => ({
          id: item.id,
          kind: "attachment" as const,
          name: item.name,
          price: item.price,
          dealerCost: null,
          brandName: availableOptionsLabel,
          category: "Compatible attachment",
          universal: false,
          sourceCatalog: "qb_attachments" as const,
          sourceId: item.id,
          metadata: {
            catalog_kind: "compatible_attachment",
            compatibility: "selected_equipment",
            compatible_for: availableOptionsLabel,
          },
        }))}
        onAdd={onAddPackageCatalogItem}
      />

      <CatalogBrowserDialog
        open={catalogBrowserOpen}
        onOpenChange={onCatalogBrowserOpenChange}
        onSelectEquipment={(entry) => {
          onAddCatalogEquipment(entry);
          onCatalogBrowserOpenChange(false);
          setStep("equipment");
        }}
        onSelectAttachment={(entry) => {
          onAddCatalogAttachment(entry);
          onCatalogBrowserOpenChange(false);
          setStep("configure");
        }}
        onRecommendation={(recommendation) => {
          setDraft((current) => ({ ...current, recommendation }));
        }}
      />

      <ReviewSendDialog
        open={reviewSendOpen}
        onOpenChange={onReviewSendOpenChange}
        draft={draft}
        setDraft={setDraft}
        customerTotal={customerTotal}
        financeMethodLabel={financeMethodLabel}
        pdfGenerating={pdfGenerating}
        pdfError={pdfError}
        onDownloadPdf={onDownloadPdf}
        shareBusy={shareBusy}
        shareUrl={shareUrl}
        shareError={shareError}
        onIssueShareLink={onIssueShareLink}
        activeQuotePackageId={activeQuotePackageId}
        internalNotes={internalNotes}
        setInternalNotes={setInternalNotes}
        packetReadiness={packetReadiness}
        approvalGranted={approvalGranted}
        requiresManagerApproval={requiresManagerApproval}
        approvalDetail={approvalDetail}
        onSendQuote={onSendQuote}
        onSent={() => {
          setDraft((current) => ({ ...current, quoteStatus: "sent" }));
          onReviewSendOpenChange(false);
        }}
      />
    </>
  );
}
