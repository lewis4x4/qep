import { useState } from "react";

import type { QuoteWorkspaceDraft } from "../../../../../../shared/qep-moonshot-contracts";
import { CustomerInfoCard } from "./CustomerInfoCard";
import { CustomerPicker, type PickedCustomer } from "./CustomerPicker";
import { SelectedCustomerChip } from "./SelectedCustomerChip";

export interface CustomerSectionProps {
  draft: QuoteWorkspaceDraft;
  onPick: (picked: PickedCustomer) => void;
  onManualChange: (
    field: "customerName" | "customerCompany" | "customerPhone" | "customerEmail",
    value: string,
  ) => void;
  onClear: () => void;
}

export function CustomerSection({
  draft,
  onPick,
  onManualChange,
  onClear,
}: CustomerSectionProps) {
  const [query, setQuery] = useState("");
  const [manualMode, setManualMode] = useState(false);

  const hasCustomer = Boolean(
    draft.customerCompany?.trim() || draft.customerName?.trim(),
  );
  const fromCrm = Boolean(draft.contactId || draft.companyId);

  if (hasCustomer && !manualMode) {
    return (
      <SelectedCustomerChip
        customerName={draft.customerName ?? ""}
        customerCompany={draft.customerCompany ?? ""}
        customerPhone={draft.customerPhone ?? ""}
        customerEmail={draft.customerEmail ?? ""}
        fromCrm={fromCrm}
        onChange={() => {
          onClear();
          setQuery("");
          setManualMode(false);
        }}
      />
    );
  }

  if (manualMode) {
    return (
      <CustomerInfoCard
        customerName={draft.customerName ?? ""}
        customerCompany={draft.customerCompany ?? ""}
        customerPhone={draft.customerPhone ?? ""}
        customerEmail={draft.customerEmail ?? ""}
        onChange={onManualChange}
      />
    );
  }

  return (
    <CustomerPicker
      query={query}
      onQueryChange={setQuery}
      onPick={(picked) => {
        onPick(picked);
        setQuery("");
      }}
      onRequestManualEntry={(startingQuery) => {
        onManualChange("customerName", startingQuery);
        setManualMode(true);
      }}
    />
  );
}
