import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServiceCreditsForm } from "../components/DealEconomics/ServiceCreditsForm";
import { InternalFreightRulesForm } from "../components/DealEconomics/InternalFreightRulesForm";
import { BrandFreightKeysForm } from "../components/DealEconomics/BrandFreightKeysForm";
import { BrandEngineStatusForm } from "../components/DealEconomics/BrandEngineStatusForm";

export function DealEconomicsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Deal Economics</h1>
        <p className="text-sm text-muted-foreground">
          Configure service credits, freight rules, brand freight keys, and Deal Engine status.
        </p>
      </div>

      <Tabs defaultValue="brand-engine-status">
        <TabsList>
          <TabsTrigger value="brand-engine-status">Deal Engine Status</TabsTrigger>
          <TabsTrigger value="service-credits">Service Credits</TabsTrigger>
          <TabsTrigger value="freight-rules">Internal Freight Rules</TabsTrigger>
          <TabsTrigger value="brand-freight-keys">Brand Freight Keys</TabsTrigger>
        </TabsList>

        <TabsContent value="brand-engine-status" className="mt-4">
          <BrandEngineStatusForm />
        </TabsContent>

        <TabsContent value="service-credits" className="mt-4">
          <ServiceCreditsForm />
        </TabsContent>

        <TabsContent value="freight-rules" className="mt-4">
          <InternalFreightRulesForm />
        </TabsContent>

        <TabsContent value="brand-freight-keys" className="mt-4">
          <BrandFreightKeysForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
