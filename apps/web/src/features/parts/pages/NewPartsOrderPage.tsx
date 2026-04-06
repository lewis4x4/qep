import { PartsSubNav } from "../components/PartsSubNav";
import { CounterSaleForm } from "../components/CounterSaleForm";
import { VoicePartsOrderButton } from "../components/VoicePartsOrderButton";
import { PhotoPartIdentifier } from "../components/PhotoPartIdentifier";

export function NewPartsOrderPage() {
  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
      <PartsSubNav />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New parts order</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Counter or phone sale — ties to a CRM company and optional catalog pricing.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <VoicePartsOrderButton />
        <PhotoPartIdentifier />
      </div>
      <CounterSaleForm />
    </div>
  );
}
