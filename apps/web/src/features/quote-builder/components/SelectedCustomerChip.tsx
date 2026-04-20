/**
 * SelectedCustomerChip — Quote Builder step 1, post-selection view.
 *
 * Shows a compact read-only summary of the customer the rep just
 * picked (or manually entered), with a "Change" button that flips
 * the parent back to the CustomerPicker.
 *
 * Rendered whenever the draft has enough info to identify a
 * customer (at minimum: customerName or customerCompany).
 */

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, Building2, Phone, Mail, RotateCcw, Sparkles } from "lucide-react";

export interface SelectedCustomerChipProps {
  customerName: string;
  customerCompany: string;
  customerPhone: string;
  customerEmail: string;
  /** True when this row was picked from the CRM, not typed fresh. */
  fromCrm: boolean;
  onChange: () => void;
}

export function SelectedCustomerChip({
  customerName,
  customerCompany,
  customerPhone,
  customerEmail,
  fromCrm,
  onChange,
}: SelectedCustomerChipProps) {
  const headline = customerCompany || customerName || "New customer";
  const sub = customerCompany && customerName ? customerName : null;

  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        {customerCompany ? (
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{headline}</span>
            {fromCrm ? (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Sparkles className="h-3 w-3" />
                CRM match
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">New</Badge>
            )}
          </div>
          {sub && (
            <div className="mt-0.5 text-xs text-muted-foreground truncate">{sub}</div>
          )}
          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            {customerPhone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" /> {customerPhone}
              </span>
            )}
            {customerEmail && (
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3" /> {customerEmail}
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onChange} className="shrink-0">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Change
        </Button>
      </div>
    </Card>
  );
}
