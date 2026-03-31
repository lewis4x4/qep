import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { getCrmCompany, listCrmCompanies } from "../lib/crm-api";
import { createCrmContactViaRouter, patchCrmContactViaRouter } from "../lib/crm-router-api";
import type { CrmContactSummary } from "../lib/types";

interface CrmContactEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: CrmContactSummary | null;
  onSaved?: (contact: CrmContactSummary) => void;
  onArchived?: () => void;
}

export function CrmContactEditorSheet({
  open,
  onOpenChange,
  contact,
  onSaved,
  onArchived,
}: CrmContactEditorSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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
          ? "The contact is out of the active CRM without a database cleanup step."
          : contact
            ? "The CRM contact record is up to date."
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
    if (!window.confirm(`Archive ${contact.firstName} ${contact.lastName}? This removes the contact from active CRM views.`)) {
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
            Capture the contact record without leaving the CRM workflow.
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
              className="flex h-11 w-full rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#0F172A] shadow-sm focus:border-[#E87722] focus:outline-none"
            >
              <option value="">No primary company</option>
              {companyOptions.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>

          {formError ? <p className="text-sm text-[#B91C1C]">{formError}</p> : null}

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
