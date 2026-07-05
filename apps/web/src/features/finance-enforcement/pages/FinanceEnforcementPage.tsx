import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InvoiceNumberingPanel } from "../components/InvoiceNumberingPanel";
import { TaxPreviewPanel } from "../components/TaxPreviewPanel";
import { CreditHoldsPanel } from "../components/CreditHoldsPanel";
import { MarginMatrixPanel } from "../components/MarginMatrixPanel";
import { EquipmentReversalPanel } from "../components/EquipmentReversalPanel";
import { Form8300Panel } from "../components/Form8300Panel";
import { FetScaffoldPanel } from "../components/FetScaffoldPanel";
import { ApThreeWayMatchPanel } from "../components/ApThreeWayMatchPanel";
import { FinanceFoundationStatusPanel } from "../components/FinanceFoundationStatusPanel";

interface FinanceEnforcementPageProps {
  userRole: string;
  userId: string;
}

/**
 * Operator console for the finance-enforcement surfaces shipped in migrations
 * 655-670 plus 766. Each panel wires a role-gated RPC / edge function and renders its own
 * loading / error / empty states.
 *
 * Queries filter on the canonical QEP tenant workspace ("default"); the real
 * tenancy boundary is enforced server-side by RLS (get_my_workspace()), so the
 * filter is defense-in-depth, not the security control.
 */
export function FinanceEnforcementPage({ userRole, userId }: FinanceEnforcementPageProps) {
  const workspaceId = "default";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Finance Enforcement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          K1.1 finance source-of-record status, branch invoice numbering, county tax sourcing,
          credit holds, margin, trade-reconditioning approval, equipment-sale reversals, Form
          8300 / FET, and AP 3-way match with the guardrails enforced server-side.
        </p>
      </header>

      <div className="mb-6">
        <FinanceFoundationStatusPanel workspaceId={workspaceId} />
      </div>

      <Tabs defaultValue="invoicing" className="w-full">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="invoicing">Invoicing &amp; Tax</TabsTrigger>
          <TabsTrigger value="receivables">Receivables</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="payables">Payables</TabsTrigger>
        </TabsList>

        <TabsContent value="invoicing" className="mt-4 space-y-6">
          <InvoiceNumberingPanel workspaceId={workspaceId} />
          <TaxPreviewPanel />
        </TabsContent>

        <TabsContent value="receivables" className="mt-4 space-y-6">
          <CreditHoldsPanel workspaceId={workspaceId} currentUserRole={userRole} />
          <MarginMatrixPanel workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="compliance" className="mt-4 space-y-6">
          <EquipmentReversalPanel
            workspaceId={workspaceId}
            currentUserId={userId}
            currentUserRole={userRole}
          />
          <Form8300Panel workspaceId={workspaceId} />
          <FetScaffoldPanel workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="payables" className="mt-4 space-y-6">
          <ApThreeWayMatchPanel workspaceId={workspaceId} currentUserRole={userRole} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
