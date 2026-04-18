import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServiceCreditsForm } from "../components/DealEconomics/ServiceCreditsForm";
import { InternalFreightRulesPlaceholder } from "../components/DealEconomics/InternalFreightRulesPlaceholder";
import { BrandFreightKeysPlaceholder } from "../components/DealEconomics/BrandFreightKeysPlaceholder";

export function DealEconomicsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Deal Economics</h1>
        <p className="text-sm text-muted-foreground">
          Configure service credits, freight rules, and brand freight keys.
        </p>
      </div>

      <Tabs defaultValue="service-credits">
        <TabsList>
          <TabsTrigger value="service-credits">Service Credits</TabsTrigger>
          <TabsTrigger value="freight-rules">Internal Freight Rules</TabsTrigger>
          <TabsTrigger value="brand-freight-keys">Brand Freight Keys</TabsTrigger>
        </TabsList>

        <TabsContent value="service-credits" className="mt-4">
          <ServiceCreditsForm />
        </TabsContent>

        <TabsContent value="freight-rules" className="mt-4">
          <InternalFreightRulesPlaceholder />
        </TabsContent>

        <TabsContent value="brand-freight-keys" className="mt-4">
          <BrandFreightKeysPlaceholder />
        </TabsContent>
      </Tabs>
    </div>
  );
}
