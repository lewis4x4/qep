import { AlertTriangle, Database, Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFinanceFoundationStatus } from "../hooks/use-finance-enforcement";
import { financeErrorMessage } from "./AsyncSection";
import type {
  FinanceConfigReadinessStatus,
  FinanceFoundationCapability,
  FinanceSystemBoundaryRow,
} from "../lib/finance-enforcement-api";

interface FinanceFoundationStatusPanelProps {
  workspaceId: string;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function boundaryLabel(role: FinanceSystemBoundaryRow["role"]): string {
  if (role === "forward_accounting_sor") return "Forward accounting SoR";
  if (role === "transition_operational_sor") return "Transition operational SoR";
  return "Downstream output only";
}

function boundaryBadgeVariant(role: FinanceSystemBoundaryRow["role"]): "success" | "secondary" | "outline" {
  if (role === "forward_accounting_sor") return "success";
  if (role === "transition_operational_sor") return "secondary";
  return "outline";
}

function ownerSystemLabel(ownerSystem: FinanceFoundationCapability["ownerSystem"]): string {
  if (ownerSystem === "qep_os") return "QEP OS";
  if (ownerSystem === "intellidealer_transition") return "IntelliDealer transition";
  return "QuickBooks downstream";
}

function configBadgeVariant(status: FinanceConfigReadinessStatus): "warning" | "success" {
  return status === "config_required" ? "warning" : "success";
}

export function FinanceFoundationStatusPanel({ workspaceId }: FinanceFoundationStatusPanelProps) {
  const status = useFinanceFoundationStatus(workspaceId);

  if (status.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>Loading finance foundation status...</span>
        </CardContent>
      </Card>
    );
  }

  if (status.isError) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex items-start gap-2 py-6 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{financeErrorMessage(status.error)}</span>
        </CardContent>
      </Card>
    );
  }

  const foundation = status.data;
  if (!foundation) return null;
  const tradeGate = foundation.capabilities.find((capability) => capability.migration === "766");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">K1.1 finance foundation status</CardTitle>
            <CardDescription>
              QEP OS is the forward finance SoR, IntelliDealer is transition SoR, and QuickBooks Desktop is downstream output only.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="success" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              QEP OS forward SoR
            </Badge>
            <Badge variant="secondary">
              IntelliDealer transition SoR
            </Badge>
            <Badge variant="outline">
              QuickBooks downstream only
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Database className="h-3.5 w-3.5" aria-hidden />
              {foundation.configSummary.configRequired} config required
            </Badge>
            <Badge variant="secondary">
              {foundation.configSummary.ownerReviewed} owner reviewed
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {tradeGate ? (
          <section
            aria-label="Trade-reconditioning finance logic"
            className="border-l-4 border-qep-success pl-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Shipped QEP OS finance logic</span>
              <Badge variant="success">migration 766</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {tradeGate.label}. Keep-and-recondition trades below the 15% expected gross-margin floor require
              sales-manager approval before commit; material recon-change reapproval remains config-required until
              owner-reviewed.
            </p>
            <p className="mt-1 max-w-3xl break-words text-xs text-muted-foreground">{tradeGate.evidence}</p>
          </section>
        ) : null}

        <section aria-label="Source-of-record boundary summary" className="grid gap-3 md:grid-cols-3">
          {foundation.systemBoundary.map((row) => (
            <div key={row.system} className="border-l-2 border-border pl-3">
              <div className="text-sm font-semibold">{row.system}</div>
              <div className="mt-1">
                <Badge variant={boundaryBadgeVariant(row.role)}>
                  {boundaryLabel(row.role)}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Ledger of record: {row.isLedgerOfRecord ? "yes" : "no"}
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">System boundary</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>System</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Ledger of record</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {foundation.systemBoundary.map((row) => (
                  <TableRow key={row.system}>
                    <TableCell className="font-medium">{row.system}</TableCell>
                    <TableCell>
                      <Badge variant={row.role === "downstream_output_only" ? "outline" : "secondary"}>
                        {boundaryLabel(row.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.isLedgerOfRecord ? "Yes" : "No"}</TableCell>
                    <TableCell className="max-w-xl break-words text-xs text-muted-foreground">{row.evidence}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Shipped foundation</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Migration</TableHead>
                  <TableHead>Capability</TableHead>
                  <TableHead>Owner system</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {foundation.capabilities.map((capability) => (
                  <TableRow key={`${capability.migration}-${capability.label}`}>
                    <TableCell className="font-mono text-xs">{capability.migration}</TableCell>
                    <TableCell>
                      <div className="font-medium">{capability.label}</div>
                      <div className="mt-0.5 max-w-xl break-words text-xs text-muted-foreground">{capability.evidence}</div>
                    </TableCell>
                    <TableCell>{ownerSystemLabel(capability.ownerSystem)}</TableCell>
                    <TableCell>
                      <Badge variant={capability.status === "shipped" ? "success" : "outline"}>
                        {capability.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Business values</h2>
          <p className="text-xs text-muted-foreground">
            Values are shown only as owner-reviewed when they have named approval evidence or differ from the parked
            safe default; otherwise the effective value stays null and config-required.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Value</TableHead>
                  <TableHead>Effective value</TableHead>
                  <TableHead>Parked default</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {foundation.requiredConfig.map((row) => (
                  <TableRow key={row.config_key}>
                    <TableCell>
                      <div className="font-medium">{row.label}</div>
                      <div className="mt-0.5 max-w-md break-words text-xs text-muted-foreground">{row.note}</div>
                    </TableCell>
                    <TableCell className="max-w-xs break-words font-mono text-xs">
                      {formatJson(row.effective_value)}
                    </TableCell>
                    <TableCell className="max-w-xs break-words font-mono text-xs">
                      {formatJson(row.parked_default)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={configBadgeVariant(row.status)}>
                        {row.status === "config_required" ? "config required" : "owner reviewed"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs break-words text-xs text-muted-foreground">
                      {row.source_migration
                        ? `migration ${row.source_migration} · ${row.authorizing_question}`
                        : row.authorizing_question}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
