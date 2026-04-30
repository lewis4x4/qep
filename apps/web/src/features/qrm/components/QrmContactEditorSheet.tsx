import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { getCrmCompany, listCrmCompanies } from "../lib/qrm-api";
import { createCrmContactViaRouter, patchCrmContactViaRouter } from "../lib/qrm-router-api";
import type { QrmContactSummary } from "../lib/types";

interface QrmContactEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: QrmContactSummary | null;
  onSaved?: (contact: QrmContactSummary) => void;
  onArchived?: () => void;
}

export function QrmContactEditorSheet({
  open,
  onOpenChange,
  contact,
  onSaved,
  onArchived,
}: QrmContactEditorSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [cell, setCell] = useState("");
  const [directPhone, setDirectPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [title, setTitle] = useState("");
  const [companySearchInput, setCompanySearchInput] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [primaryCompanyId, setPrimaryCompanyId] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFirstName(contact?.firstName ?? "");
    setLastName(contact?.lastName ?? "");
    setEmail(contact?.email ?? "");
    setPhone(contact?.phone ?? "");
    setCell(contact?.cell ?? "");
    setDirectPhone(contact?.directPhone ?? "");
    setBirthDate(contact?.birthDate ?? "");
    setSmsOptIn(contact?.smsOptIn ?? false);
    setTitle(contact?.title ?? "");
    setPrimaryCompanyId(contact?.primaryCompanyId ?? "");
    setCompanySearchInput("");
    setCompanySearch("");
    setFormError(null);
  }, [contact, open]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCompanySearch(companySearchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [companySearchInput]);

  const companiesQuery = useQuery({
    queryKey: ["crm", "companies", "contact-editor", companySearch],
    queryFn: () => listCrmCompanies(companySearch),
    enabled: open,
    staleTime: 60_000,
  });

  const selectedCompanyQuery = useQuery({
    queryKey: ["crm", "company", "contact-editor-selected", primaryCompanyId],
    queryFn: () => getCrmCompany(primaryCompanyId),
    enabled: open && Boolean(primaryCompanyId),
    staleTime: 60_000,
  });

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

  const mutation = useMutation({
    mutationFn: async ({ archive }: { archive: boolean }) => {
      if (archive) {
        if (!contact) {
          throw new Error("Only existing contacts can be archived.");
        }
        return patchCrmContactViaRouter(contact.id, { archive: true });
      }

      const payload = {
        firstName,
        lastName,
        email: email.trim() || null,
        phone: phone.trim() || null,
        cell: cell.trim() || null,
        directPhone: directPhone.trim() || null,
        birthDate: birthDate || null,
        smsOptIn,
        title: title.trim() || null,
        primaryCompanyId: primaryCompanyId || null,
      };

      return contact
        ? patchCrmContactViaRouter(contact.id, payload)
        : createCrmContactViaRouter(payload);
    },
    onSuccess: async (savedContact, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm", "contacts"] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "contact", savedContact.id] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "activities"] }),
      ]);
      toast({
        title: variables.archive ? "Contact archived" : contact ? "Contact updated" : "Contact created",
        description: variables.archive
          ? "The contact is out of the active QRM without a database cleanup step."
          : contact
            ? "The QRM contact record is up to date."
            : "The contact is ready for activity logging and deal work.",
      });
      if (variables.archive) {
        onArchived?.();
      } else {
        onSaved?.(savedContact);
      }
      onOpenChange(false);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Could not save the contact.";
      setFormError(message);
      toast({
        title: "Could not save contact",
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
    if (!contact || mutation.isPending) return;
    if (!window.confirm(`Archive ${contact.firstName} ${contact.lastName}? This removes the contact from active QRM views.`)) {
      return;
    }
    setFormError(null);
    await mutation.mutateAsync({ archive: true });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="mb-4">
          <SheetTitle>{contact ? "Edit contact" : "New contact"}</SheetTitle>
          <SheetDescription>
            Capture the contact record without leaving the QRM workflow.
          </SheetDescription>
        </SheetHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="crm-contact-first-name">First name</Label>
              <Input
                id="crm-contact-first-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="Rylee"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crm-contact-last-name">Last name</Label>
              <Input
                id="crm-contact-last-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                placeholder="McKenzie"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="crm-contact-title">Title</Label>
            <Input
              id="crm-contact-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Sales manager"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="crm-contact-email">Email</Label>
              <Input
                id="crm-contact-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="crm-contact-phone">Phone</Label>
              <Input
                id="crm-contact-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="(386) 555-0184"
              />
            </div>
          </div>

          {contact?.sourceCustomerNumber || contact?.sourceContactNumber ? (
            <div className="rounded-md border border-sky-500/20 bg-sky-500/[0.04] p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Imported source</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {contact.sourceCustomerNumber ? (
                  <div>
                    <span className="block text-xs text-muted-foreground">IntelliDealer customer #</span>
                    <span className="font-medium text-foreground">{contact.sourceCustomerNumber}</span>
                  </div>
                ) : null}
                {contact.sourceContactNumber ? (
                  <div>
                    <span className="block text-xs text-muted-foreground">IntelliDealer contact #</span>
                    <span className="font-medium text-foreground">{contact.sourceContactNumber}</span>
                  </div>
                ) : null}
                {contact.sourceStatusCode ? (
                  <div>
                    <span className="block text-xs text-muted-foreground">Status code</span>
                    <span className="font-medium text-foreground">{contact.sourceStatusCode}</span>
                  </div>
                ) : null}
                {contact.sourceSalespersonCode ? (
                  <div>
                    <span className="block text-xs text-muted-foreground">Salesperson</span>
                    <span className="font-medium text-foreground">{contact.sourceSalespersonCode}</span>
                  </div>
                ) : null}
              </div>
              {contact.myDealerUser ? (
                <p className="mt-2 text-xs text-muted-foreground">MyDealer user: {contact.myDealerUser}</p>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-md border border-qep-deck-rule/70 bg-muted/20 p-3">
            <div className="mb-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">IntelliDealer contact profile</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Safe imported contact fields used for calling, texting, and account context.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="crm-contact-cell">Cell phone</Label>
                <Input
                  id="crm-contact-cell"
                  value={cell}
                  onChange={(event) => setCell(event.target.value)}
                  placeholder="(386) 555-0102"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-contact-direct-phone">Direct phone</Label>
                <Input
                  id="crm-contact-direct-phone"
                  value={directPhone}
                  onChange={(event) => setDirectPhone(event.target.value)}
                  placeholder="(386) 555-0138"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-contact-birth-date">Birth date</Label>
                <Input
                  id="crm-contact-birth-date"
                  type="date"
                  value={birthDate}
                  onChange={(event) => setBirthDate(event.target.value)}
                />
              </div>
            </div>

            <label
              htmlFor="crm-contact-sms-opt-in"
              className="mt-4 flex items-start gap-3 rounded-md border border-qep-deck-rule/60 bg-background/60 p-3 text-sm"
            >
              <input
                id="crm-contact-sms-opt-in"
                type="checkbox"
                checked={smsOptIn}
                onChange={(event) => setSmsOptIn(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-input"
              />
              <span>
                <span className="block font-medium text-foreground">SMS opt-in</span>
                <span className="text-xs text-muted-foreground">
                  Use only when the customer has explicitly approved text communication.
                </span>
              </span>
            </label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="crm-contact-company-search">Primary company</Label>
            <Input
              id="crm-contact-company-search"
              value={companySearchInput}
              onChange={(event) => setCompanySearchInput(event.target.value)}
              placeholder="Search companies"
            />
            <select
              value={primaryCompanyId}
              onChange={(event) => setPrimaryCompanyId(event.target.value)}
              className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none"
            >
              <option value="">No primary company</option>
              {companyOptions.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>

          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            {contact ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleArchive()}
                disabled={mutation.isPending}
                className="sm:mr-auto"
              >
                {mutation.isPending ? "Working..." : "Archive contact"}
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
              {mutation.isPending ? "Saving..." : contact ? "Save contact" : "Create contact"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
