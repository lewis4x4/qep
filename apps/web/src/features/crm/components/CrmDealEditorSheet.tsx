import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { getCrmCompany, getCrmContact, listCrmCompanies, listCrmContacts, listCrmDealStages } from "../lib/crm-api";
import { toDateTimeLocalValue, toIsoOrNull } from "../lib/deal-date";
import { createCrmDealViaRouter, patchCrmDealViaRouter } from "../lib/crm-router-api";
import type { CrmRepSafeDeal } from "../lib/types";

interface CrmDealEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: CrmRepSafeDeal | null;
  onSaved?: (deal: CrmRepSafeDeal) => void;
  onArchived?: () => void;
}

export function CrmDealEditorSheet({
  open,
  onOpenChange,
  deal,
  onSaved,
  onArchived,
}: CrmDealEditorSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [stageId, setStageId] = useState("");
  const [contactSearchInput, setContactSearchInput] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [primaryContactId, setPrimaryContactId] = useState("");
  const [companySearchInput, setCompanySearchInput] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [expectedCloseOn, setExpectedCloseOn] = useState("");
  const [nextFollowUpInput, setNextFollowUpInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(deal?.name ?? "");
    setStageId(deal?.stageId ?? "");
    setPrimaryContactId(deal?.primaryContactId ?? "");
    setCompanyId(deal?.companyId ?? "");
    setAmountInput(typeof deal?.amount === "number" ? String(deal.amount) : "");
    setExpectedCloseOn(deal?.expectedCloseOn ?? "");
    setNextFollowUpInput(toDateTimeLocalValue(deal?.nextFollowUpAt ?? null));
    setContactSearchInput("");
    setContactSearch("");
    setCompanySearchInput("");
    setCompanySearch("");
    setFormError(null);
  }, [deal, open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setContactSearch(contactSearchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [contactSearchInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => setCompanySearch(companySearchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [companySearchInput]);

  const stagesQuery = useQuery({
    queryKey: ["crm", "deal-stages"],
    queryFn: listCrmDealStages,
    enabled: open,
    staleTime: 60_000,
  });

  const contactsQuery = useQuery({
    queryKey: ["crm", "contacts", "deal-editor", contactSearch],
    queryFn: () => listCrmContacts(contactSearch),
    enabled: open,
    staleTime: 60_000,
  });

  const companiesQuery = useQuery({
    queryKey: ["crm", "companies", "deal-editor", companySearch],
    queryFn: () => listCrmCompanies(companySearch),
    enabled: open,
    staleTime: 60_000,
  });

  const selectedContactQuery = useQuery({
    queryKey: ["crm", "contact", "deal-editor-selected", primaryContactId],
    queryFn: () => getCrmContact(primaryContactId),
    enabled: open && Boolean(primaryContactId),
    staleTime: 60_000,
  });

  const selectedCompanyQuery = useQuery({
    queryKey: ["crm", "company", "deal-editor-selected", companyId],
    queryFn: () => getCrmCompany(companyId),
    enabled: open && Boolean(companyId),
    staleTime: 60_000,
  });

  const contactOptions = useMemo(() => {
    const items = [...(contactsQuery.data?.items ?? [])];
    if (
      selectedContactQuery.data &&
      !items.some((contactOption) => contactOption.id === selectedContactQuery.data?.id)
    ) {
      items.unshift(selectedContactQuery.data);
    }
    return items;
  }, [contactsQuery.data?.items, selectedContactQuery.data]);

  const companyOptions = useMemo(() => {
    const items = [...(companiesQuery.data?.items ?? [])];
    if (
      selectedCompanyQuery.data &&
      !items.some((companyOption) => companyOption.id === selectedCompanyQuery.data?.id)
    ) {
      items.unshift(selectedCompanyQuery.data);
    }
    return items;
  }, [companiesQuery.data?.items, selectedCompanyQuery.data]);
  const stageOptions = useMemo(
    () => (stagesQuery.data ?? []).filter((stageOption) => deal || (!stageOption.isClosedWon && !stageOption.isClosedLost)),
    [deal, stagesQuery.data],
  );

  const mutation = useMutation({
    mutationFn: async ({ archive }: { archive: boolean }) => {
      if (archive) {
        if (!deal) {
          throw new Error("Only existing deals can be archived.");
        }
        return patchCrmDealViaRouter(deal.id, { archive: true });
      }

      const amount = amountInput.trim().length > 0 ? Number(amountInput) : null;
      if (amountInput.trim().length > 0 && !Number.isFinite(amount)) {
        throw new Error("Enter a valid deal amount.");
      }

      if (deal) {
        return patchCrmDealViaRouter(deal.id, {
          name,
          stageId,
          primaryContactId: primaryContactId || null,
          companyId: companyId || null,
          amount,
          expectedCloseOn: expectedCloseOn || null,
          nextFollowUpAt: toIsoOrNull(nextFollowUpInput),
        });
      }

      return createCrmDealViaRouter({
        name,
        stageId,
        primaryContactId: primaryContactId || null,
        companyId: companyId || null,
        amount,
        expectedCloseOn: expectedCloseOn || null,
        nextFollowUpAt: toIsoOrNull(nextFollowUpInput),
      });
    },
    onSuccess: async (savedDeal, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm", "deals"] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "pipeline"] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "deal", savedDeal.id] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "contact"] }),
      ]);
      toast({
        title: variables.archive ? "Deal archived" : deal ? "Deal updated" : "Deal created",
        description: variables.archive
          ? "The deal is out of the active pipeline."
          : deal
            ? "The pipeline record has been updated."
            : "The deal is live in the CRM pipeline.",
      });
      if (variables.archive) {
        onArchived?.();
      } else {
        onSaved?.(savedDeal);
      }
      onOpenChange(false);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Could not save the deal.";
      setFormError(message);
      toast({
        title: "Could not save deal",
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
    if (!deal || mutation.isPending) return;
    if (!window.confirm(`Archive ${deal.name}? This removes the deal from the active pipeline.`)) {
      return;
    }
    setFormError(null);
    await mutation.mutateAsync({ archive: true });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="mb-4">
          <SheetTitle>{deal ? "Edit deal" : "New deal"}</SheetTitle>
          <SheetDescription>
            Keep the pipeline current without dropping out of the sales workflow.
          </SheetDescription>
        </SheetHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="crm-deal-name">Deal name</Label>
            <Input
              id="crm-deal-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Bandit 2590TG package"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="crm-deal-stage">Stage</Label>
            <select
              id="crm-deal-stage"
              value={stageId}
              onChange={(event) => setStageId(event.target.value)}
              className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
              required
            >
              <option value="">Select a stage</option>
              {stageOptions.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="crm-deal-contact-search">Primary contact</Label>
            <Input
              id="crm-deal-contact-search"
              value={contactSearchInput}
              onChange={(event) => setContactSearchInput(event.target.value)}
              placeholder="Search contacts"
            />
            <select
              value={primaryContactId}
              onChange={(event) => setPrimaryContactId(event.target.value)}
              className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
            >
              <option value="">No primary contact</option>
              {contactOptions.map((contactOption) => (
                <option key={contactOption.id} value={contactOption.id}>
                  {contactOption.firstName} {contactOption.lastName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="crm-deal-company-search">Company</Label>
            <Input
              id="crm-deal-company-search"
              value={companySearchInput}
              onChange={(event) => setCompanySearchInput(event.target.value)}
              placeholder="Search companies"
            />
            <select
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
            >
              <option value="">No company linked</option>
              {companyOptions.map((companyOption) => (
                <option key={companyOption.id} value={companyOption.id}>
                  {companyOption.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="crm-deal-amount">Amount</Label>
              <Input
                id="crm-deal-amount"
                inputMode="decimal"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                placeholder="125000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crm-deal-close-on">Expected close date</Label>
              <Input
                id="crm-deal-close-on"
                type="date"
                value={expectedCloseOn}
                onChange={(event) => setExpectedCloseOn(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="crm-deal-follow-up">Next follow-up</Label>
            <Input
              id="crm-deal-follow-up"
              type="datetime-local"
              value={nextFollowUpInput}
              onChange={(event) => setNextFollowUpInput(event.target.value)}
            />
          </div>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            {deal ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleArchive()}
                disabled={mutation.isPending}
                className="sm:mr-auto"
              >
                {mutation.isPending ? "Working..." : "Archive deal"}
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
              {mutation.isPending ? "Saving..." : deal ? "Save deal" : "Create deal"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
