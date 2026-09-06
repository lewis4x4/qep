import { RENTAL_ASSESSMENT_FIELDS, type RentalNeedsAssessment } from "../../../../../../shared/rental-needs-assessment";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { rentalOpsApi } from "../lib/rental-ops-api";
export function RentalTransportContractLink(
  { ticketId, ticketStatus }: { ticketId: string; ticketStatus?: string },
) {
  const { profile } = useAuth();
  const [contractId, setContractId] = useState("");
  const context = useQuery({
    queryKey: [
      "rental-transport",
      profile?.id,
      profile?.active_workspace_id,
      ticketId,
      ticketStatus,
    ],
    queryFn: () => rentalOpsApi.transportContext(ticketId),
  });
  useEffect(() => {
    const ticket = context.data?.ticket as
      | { rental_contract_id?: string }
      | undefined;
    setContractId(ticket?.rental_contract_id ?? "");
  }, [context.data, ticketId]);
  const link = useMutation({
    mutationFn: () => rentalOpsApi.linkTransport(ticketId, contractId),
    onSuccess: () => context.refetch(),
  });
  const contracts = (context.data?.contracts ?? []) as Array<
    {
      id: string;
      contract_number: string;
      native_signature_id: string | null;
      requested_start_date: string;
      requested_end_date: string;
    }
  >;
  const handoff = (context.data?.ticket as { rental_needs_assessment_snapshot?: RentalNeedsAssessment } | undefined)?.rental_needs_assessment_snapshot;
  return (
    <div className="mt-2 space-y-2 rounded border p-2">
      <p className="text-xs">
        Link the rental agreement before scheduling. The database verifies a
        valid signature for this agreement.
      </p>
      <select
        aria-label="Rental agreement for transport"
        value={contractId}
        onChange={(e) => setContractId(e.target.value)}
        className="w-full rounded border bg-background p-2 text-sm"
      >
        <option value="">Select agreement</option>
        {contracts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.contract_number} · {c.requested_start_date} to{" "}
            {c.requested_end_date} ·{" "}
            {c.native_signature_id ? "signature recorded" : "unsigned"}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        disabled={!contractId || link.isPending || profile?.role === ("driver" as string)}
        onClick={() => link.mutate()}
      >
        {link.isPending ? "Saving…" : "Link agreement"}
      </Button>
      {handoff?.answers ? <details className="rounded border p-2"><summary>Customer requirements and jobsite handoff</summary><dl className="mt-2 space-y-2 text-xs">{RENTAL_ASSESSMENT_FIELDS.map(([key,,label]) => <div key={key}><dt className="font-medium">{label}</dt><dd>{handoff.answers[key]?.status === "answered" ? handoff.answers[key].value : handoff.answers[key]?.status === "not_applicable" ? "Not applicable" : "Asked, unknown"}</dd></div>)}</dl>{handoff.narrative ? <p className="mt-2 whitespace-pre-wrap text-xs">{handoff.narrative}</p> : null}</details> : null}
      {(context.error || link.error)
        ? (
          <p role="alert" className="text-xs text-destructive">
            {(context.error || link.error)?.message}
          </p>
        )
        : link.isSuccess
        ? <p role="status" className="text-xs">Agreement link saved</p>
        : null}
    </div>
  );
}
