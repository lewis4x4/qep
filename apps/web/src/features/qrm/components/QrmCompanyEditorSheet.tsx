import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { createCrmCompanyViaRouter, patchCrmCompanyViaRouter } from "../lib/qrm-router-api";
import type { QrmCompanySummary } from "../lib/types";

const PRODUCT_CATEGORY_OPTIONS = [
  { value: "", label: "Unspecified" },
  { value: "business", label: "Business" },
  { value: "individual", label: "Individual" },
  { value: "government", label: "Government" },
  { value: "non_profit", label: "Non-profit" },
  { value: "internal", label: "Internal" },
] as const;

const AR_TYPE_OPTIONS = [
  { value: "", label: "Unspecified" },
  { value: "open_item", label: "Open item" },
  { value: "balance_forward", label: "Balance forward" },
  { value: "true_balance_forward", label: "True balance forward" },
] as const;

interface QrmCompanyEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: QrmCompanySummary | null;
  canManageEin?: boolean;
  onSaved?: (company: QrmCompanySummary) => void;
  onArchived?: () => void;
}

export function QrmCompanyEditorSheet({
  open,
  onOpenChange,
  company,
  canManageEin = false,
  onSaved,
  onArchived,
}: QrmCompanyEditorSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [search1, setSearch1] = useState("");
  const [search2, setSearch2] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [ein, setEin] = useState("");
  const [status, setStatus] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [arType, setArType] = useState("");
  const [paymentTermsCode, setPaymentTermsCode] = useState("");
  const [termsCode, setTermsCode] = useState("");
  const [territoryCode, setTerritoryCode] = useState("");
  const [pricingLevel, setPricingLevel] = useState("");
  const [doNotContact, setDoNotContact] = useState(false);
  const [optOutSalePi, setOptOutSalePi] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const einCanBeSubmitted = canManageEin && (!company || company.ein !== undefined);

  useEffect(() => {
    if (!open) return;
    setName(company?.name ?? "");
    setSearch1(company?.search1 ?? "");
    setSearch2(company?.search2 ?? "");
    setAddressLine1(company?.addressLine1 ?? "");
    setAddressLine2(company?.addressLine2 ?? "");
    setCity(company?.city ?? "");
    setState(company?.state ?? "");
    setPostalCode(company?.postalCode ?? "");
    setCountry(company?.country ?? "");
    setEin(company?.ein && !company.einMasked ? company.ein : "");
    setStatus(company?.status ?? "");
    setProductCategory(company?.productCategory ?? "");
    setArType(company?.arType ?? "");
    setPaymentTermsCode(company?.paymentTermsCode ?? "");
    setTermsCode(company?.termsCode ?? "");
    setTerritoryCode(company?.territoryCode ?? "");
    setPricingLevel(company?.pricingLevel == null ? "" : String(company.pricingLevel));
    setDoNotContact(company?.doNotContact ?? false);
    setOptOutSalePi(company?.optOutSalePi ?? false);
    setFormError(null);
  }, [company, open]);

  const mutation = useMutation({
    mutationFn: async ({ archive }: { archive: boolean }) => {
      if (archive) {
        if (!company) {
          throw new Error("Only existing companies can be archived.");
        }
        return patchCrmCompanyViaRouter(company.id, { archive: true });
      }

      const parsedPricingLevel = pricingLevel.trim() ? Number(pricingLevel) : null;
      if (parsedPricingLevel != null && !Number.isFinite(parsedPricingLevel)) {
        throw new Error("Pricing level must be a number.");
      }

      const payload = {
        name,
        search1: search1.trim() || null,
        search2: search2.trim() || null,
        addressLine1: addressLine1.trim() || null,
        addressLine2: addressLine2.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        postalCode: postalCode.trim() || null,
        country: country.trim() || null,
        status: status.trim() || null,
        productCategory: (productCategory || null) as QrmCompanySummary["productCategory"],
        arType: (arType || null) as QrmCompanySummary["arType"],
        paymentTermsCode: paymentTermsCode.trim() || null,
        termsCode: termsCode.trim() || null,
        territoryCode: territoryCode.trim() || null,
        pricingLevel: parsedPricingLevel,
        doNotContact,
        optOutSalePi,
        ...(einCanBeSubmitted ? { ein: ein.trim() || null } : {}),
      };

      return company
        ? patchCrmCompanyViaRouter(company.id, payload)
        : createCrmCompanyViaRouter(payload);
    },
    onSuccess: async (savedCompany, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm", "companies"] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "company", savedCompany.id] }),
        queryClient.invalidateQueries({ queryKey: ["account-360", savedCompany.id] }),
        queryClient.invalidateQueries({ queryKey: ["account-command", savedCompany.id] }),
      ]);
      toast({
        title: variables.archive ? "Company archived" : company ? "Company updated" : "Company created",
        description: variables.archive
          ? "The company is out of the active QRM and can be restored from backups if needed."
          : company
            ? "The account record is up to date."
            : "The company is ready for contact, equipment, and activity work.",
      });
      if (variables.archive) {
        onArchived?.();
      } else {
        onSaved?.(savedCompany);
      }
      onOpenChange(false);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Could not save the company.";
      setFormError(message);
      toast({
        title: "Could not save company",
        description: message,
        variant: "destructive",
      });
    },
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    await mutation.mutateAsync({ archive: false });
  }

  async function handleArchive(): Promise<void> {
    if (!company || mutation.isPending) return;
    if (!window.confirm(`Archive ${company.name}? This removes the company from active QRM views.`)) {
      return;
    }
    setFormError(null);
    await mutation.mutateAsync({ archive: true });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="mb-4">
          <SheetTitle>{company ? "Edit company" : "New company"}</SheetTitle>
          <SheetDescription>
            Keep account details clean before contacts, equipment, and deals branch off.
          </SheetDescription>
        </SheetHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="crm-company-name">Company name</Label>
            <Input
              id="crm-company-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Quality Equipment & Parts"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="crm-company-search-1">Search 1</Label>
              <Input
                id="crm-company-search-1"
                value={search1}
                onChange={(event) => setSearch1(event.target.value)}
                placeholder="Legacy starts-with code"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crm-company-search-2">Search 2</Label>
              <Input
                id="crm-company-search-2"
                value={search2}
                onChange={(event) => setSearch2(event.target.value)}
                placeholder="Second starts-with code"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="crm-company-address-1">Address line 1</Label>
            <Input
              id="crm-company-address-1"
              value={addressLine1}
              onChange={(event) => setAddressLine1(event.target.value)}
              placeholder="1234 Highway 90"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="crm-company-address-2">Address line 2</Label>
            <Input
              id="crm-company-address-2"
              value={addressLine2}
              onChange={(event) => setAddressLine2(event.target.value)}
              placeholder="Suite, yard, or branch detail"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="crm-company-city">City</Label>
              <Input
                id="crm-company-city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Lake City"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crm-company-state">State</Label>
              <Input
                id="crm-company-state"
                value={state}
                onChange={(event) => setState(event.target.value)}
                placeholder="FL"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="crm-company-postal">Postal code</Label>
              <Input
                id="crm-company-postal"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                placeholder="32055"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crm-company-country">Country</Label>
              <Input
                id="crm-company-country"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                placeholder="USA"
              />
            </div>
          </div>

          {einCanBeSubmitted ? (
            <div className="rounded-md border border-qep-deck-rule/70 bg-muted/20 p-3">
              <div className="space-y-2">
                <Label htmlFor="crm-company-ein">Federal EIN</Label>
                <Input
                  id="crm-company-ein"
                  value={ein}
                  onChange={(event) => setEin(event.target.value)}
                  placeholder="12-3456789"
                  inputMode="text"
                  pattern="[0-9]{2}-[0-9]{7}"
                />
                <p className="text-xs text-muted-foreground">
                  NN-NNNNNNN format. Visible only to elevated roles.
                </p>
              </div>
            </div>
          ) : canManageEin && company ? (
            <div className="rounded-md border border-qep-deck-rule/70 bg-muted/20 p-3 text-sm text-muted-foreground">
              Federal EIN is still loading or unavailable. Saving this form will not change the existing EIN.
            </div>
          ) : company?.ein ? (
            <div className="rounded-md border border-qep-deck-rule/70 bg-muted/20 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Tax / Regulatory</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Federal EIN</span>
                <span className="font-medium text-foreground">{company.ein}</span>
              </div>
              {company.einMasked ? (
                <p className="mt-1 text-xs text-muted-foreground">Masked for unauthorized roles.</p>
              ) : null}
            </div>
          ) : null}

          {company?.legacyCustomerNumber ? (
            <div className="rounded-md border border-sky-500/20 bg-sky-500/[0.04] p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Imported source</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">IntelliDealer customer #</span>
                <span className="font-medium text-foreground">{company.legacyCustomerNumber}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Legacy IDs stay read-only so imported records remain traceable.
              </p>
            </div>
          ) : null}

          <div className="rounded-md border border-qep-deck-rule/70 bg-muted/20 p-3">
            <div className="mb-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">IntelliDealer operating profile</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Safe imported fields used for routing, terms, and account handling. Card and credit details are not editable here.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="crm-company-status">Status</Label>
                <Input
                  id="crm-company-status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  placeholder="Active"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-company-product-category">Product category</Label>
                <select
                  id="crm-company-product-category"
                  value={productCategory}
                  onChange={(event) => setProductCategory(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {PRODUCT_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-company-ar-type">A/R type</Label>
                <select
                  id="crm-company-ar-type"
                  value={arType}
                  onChange={(event) => setArType(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {AR_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-company-payment-terms">Payment terms</Label>
                <Input
                  id="crm-company-payment-terms"
                  value={paymentTermsCode}
                  onChange={(event) => setPaymentTermsCode(event.target.value)}
                  placeholder="NET30"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-company-terms-code">Terms code</Label>
                <Input
                  id="crm-company-terms-code"
                  value={termsCode}
                  onChange={(event) => setTermsCode(event.target.value)}
                  placeholder="COD"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-company-territory">Territory</Label>
                <Input
                  id="crm-company-territory"
                  value={territoryCode}
                  onChange={(event) => setTerritoryCode(event.target.value)}
                  placeholder="SE"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-company-pricing-level">Pricing level</Label>
                <Input
                  id="crm-company-pricing-level"
                  value={pricingLevel}
                  onChange={(event) => setPricingLevel(event.target.value)}
                  placeholder="1"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <label
                htmlFor="crm-company-do-not-contact"
                className="flex items-start gap-3 rounded-md border border-qep-deck-rule/60 bg-background/60 p-3 text-sm"
              >
                <input
                  id="crm-company-do-not-contact"
                  type="checkbox"
                  checked={doNotContact}
                  onChange={(event) => setDoNotContact(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input"
                />
                <span>
                  <span className="block font-medium text-foreground">Do not contact</span>
                  <span className="text-xs text-muted-foreground">Suppress outreach when IntelliDealer marks the customer restricted.</span>
                </span>
              </label>
              <label
                htmlFor="crm-company-opt-out-sale-pi"
                className="flex items-start gap-3 rounded-md border border-qep-deck-rule/60 bg-background/60 p-3 text-sm"
              >
                <input
                  id="crm-company-opt-out-sale-pi"
                  type="checkbox"
                  checked={optOutSalePi}
                  onChange={(event) => setOptOutSalePi(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input"
                />
                <span>
                  <span className="block font-medium text-foreground">Opt out sale PI</span>
                  <span className="text-xs text-muted-foreground">Respect imported privacy and sales-personal-information preferences.</span>
                </span>
              </label>
            </div>
          </div>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            {company ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleArchive()}
                disabled={mutation.isPending}
                className="sm:mr-auto"
              >
                {mutation.isPending ? "Working..." : "Archive company"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : company ? "Save company" : "Create company"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
