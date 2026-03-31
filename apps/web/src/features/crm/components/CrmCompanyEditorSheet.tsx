import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { createCrmCompanyViaRouter, patchCrmCompanyViaRouter } from "../lib/crm-router-api";
import type { CrmCompanySummary } from "../lib/types";

interface CrmCompanyEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: CrmCompanySummary | null;
  onSaved?: (company: CrmCompanySummary) => void;
  onArchived?: () => void;
}

export function CrmCompanyEditorSheet({
  open,
  onOpenChange,
  company,
  onSaved,
  onArchived,
}: CrmCompanyEditorSheetProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(company?.name ?? "");
    setAddressLine1(company?.addressLine1 ?? "");
    setAddressLine2(company?.addressLine2 ?? "");
    setCity(company?.city ?? "");
    setState(company?.state ?? "");
    setPostalCode(company?.postalCode ?? "");
    setCountry(company?.country ?? "");
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

      const payload = {
        name,
        addressLine1: addressLine1.trim() || null,
        addressLine2: addressLine2.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        postalCode: postalCode.trim() || null,
        country: country.trim() || null,
      };

      return company
        ? patchCrmCompanyViaRouter(company.id, payload)
        : createCrmCompanyViaRouter(payload);
    },
    onSuccess: async (savedCompany, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm", "companies"] }),
        queryClient.invalidateQueries({ queryKey: ["crm", "company", savedCompany.id] }),
      ]);
      toast({
        title: variables.archive ? "Company archived" : company ? "Company updated" : "Company created",
        description: variables.archive
          ? "The company is out of the active CRM and can be restored from backups if needed."
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
    if (!window.confirm(`Archive ${company.name}? This removes the company from active CRM views.`)) {
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
