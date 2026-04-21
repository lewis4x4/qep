import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { QrmCompanyShipToAddress, QrmCompanyShipToInput } from "../lib/types";

interface QrmCompanyShipToSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipTo?: QrmCompanyShipToAddress | null;
  isPending: boolean;
  onSubmit: (input: QrmCompanyShipToInput) => Promise<void> | void;
}

export function QrmCompanyShipToSheet({
  open,
  onOpenChange,
  shipTo,
  isPending,
  onSubmit,
}: QrmCompanyShipToSheetProps) {
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [instructions, setInstructions] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isPrimary, setIsPrimary] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(shipTo?.name ?? "");
    setContactName(shipTo?.contactName ?? "");
    setPhone(shipTo?.phone ?? "");
    setAddressLine1(shipTo?.addressLine1 ?? "");
    setAddressLine2(shipTo?.addressLine2 ?? "");
    setCity(shipTo?.city ?? "");
    setState(shipTo?.state ?? "");
    setPostalCode(shipTo?.postalCode ?? "");
    setCountry(shipTo?.country ?? "");
    setInstructions(shipTo?.instructions ?? "");
    setSortOrder(String(shipTo?.sortOrder ?? 0));
    setIsPrimary(shipTo?.isPrimary ?? false);
  }, [open, shipTo]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedSortOrder = Number.parseInt(sortOrder, 10);
    await onSubmit({
      name,
      contactName: contactName.trim() || null,
      phone: phone.trim() || null,
      addressLine1: addressLine1.trim() || null,
      addressLine2: addressLine2.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      postalCode: postalCode.trim() || null,
      country: country.trim() || null,
      instructions: instructions.trim() || null,
      isPrimary,
      sortOrder: Number.isFinite(parsedSortOrder) ? parsedSortOrder : 0,
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="mb-4">
          <SheetTitle>{shipTo ? "Edit ship-to address" : "Add ship-to address"}</SheetTitle>
          <SheetDescription>
            Store named delivery destinations for this company so reps and operations stop retyping shipping details.
          </SheetDescription>
        </SheetHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="ship-to-name">Ship-to name</Label>
            <Input
              id="ship-to-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Main yard"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ship-to-contact">Contact name</Label>
              <Input
                id="ship-to-contact"
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Yard manager"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ship-to-phone">Phone</Label>
              <Input
                id="ship-to-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="386-555-0199"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ship-to-address-1">Address line 1</Label>
            <Input
              id="ship-to-address-1"
              value={addressLine1}
              onChange={(event) => setAddressLine1(event.target.value)}
              placeholder="1234 County Road 12"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ship-to-address-2">Address line 2</Label>
            <Input
              id="ship-to-address-2"
              value={addressLine2}
              onChange={(event) => setAddressLine2(event.target.value)}
              placeholder="Gate code, building, dock, or yard notes"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ship-to-city">City</Label>
              <Input
                id="ship-to-city"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Lake City"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ship-to-state">State</Label>
              <Input
                id="ship-to-state"
                value={state}
                onChange={(event) => setState(event.target.value)}
                placeholder="FL"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ship-to-postal">Postal code</Label>
              <Input
                id="ship-to-postal"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                placeholder="32055"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ship-to-country">Country</Label>
              <Input
                id="ship-to-country"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                placeholder="USA"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ship-to-sort-order">Sort order</Label>
              <Input
                id="ship-to-sort-order"
                type="number"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
                placeholder="0"
              />
            </div>
            <label className="flex min-h-[44px] items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(event) => setIsPrimary(event.target.checked)}
              />
              Make this the primary ship-to
            </label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ship-to-instructions">Instructions</Label>
            <textarea
              id="ship-to-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Gate opens after 7 AM. Call before entering the yard."
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : shipTo ? "Save ship-to" : "Add ship-to"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
