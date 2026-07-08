/**
 * React Query hooks for the finance-enforcement surfaces. Reads expose
 * isLoading / isError / data (consumed by <AsyncSection/>); mutations invalidate
 * their related read so the UI reflects enforcement side effects immediately.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../lib/finance-enforcement-api";

const keys = {
  foundationStatus: (ws: string) => ["fin", "foundation-status", ws] as const,
  invoiceSequences: (ws: string) => ["fin", "invoice-sequences", ws] as const,
  heldAccounts: (ws: string) => ["fin", "held-accounts", ws] as const,
  marginMatrix: (ws: string) => ["fin", "margin-matrix", ws] as const,
  reversalAudit: (ws: string) => ["fin", "reversal-audit", ws] as const,
  form8300: (ws: string) => ["fin", "form-8300", ws] as const,
  fetCategories: (ws: string) => ["fin", "fet-categories", ws] as const,
  vendorInvoices: (ws: string) => ["fin", "vendor-invoices", ws] as const,
  openArInvoices: (ws: string) => ["fin", "open-ar-invoices", ws] as const,
};

// K1.1 foundation / system-of-record status
export function useFinanceFoundationStatus(workspaceId: string) {
  return useQuery({
    queryKey: keys.foundationStatus(workspaceId),
    queryFn: () => api.getFinanceFoundationStatus(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

// 1. Invoice numbering
export function useInvoiceSequences(workspaceId: string) {
  return useQuery({
    queryKey: keys.invoiceSequences(workspaceId),
    queryFn: () => api.listInvoiceSequences(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useGenerateInvoiceNumber(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { branchLegacyCode: string; invoiceType: api.InvoiceDeptType }) =>
      api.generateInvoiceNumber({ workspaceId, ...params }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invoiceSequences(workspaceId) }),
  });
}

// 2. Tax preview
export function usePreviewTax() {
  return useMutation({ mutationFn: (req: api.TaxPreviewRequest) => api.previewTax(req) });
}

// 3. Credit holds
export function useHeldAccounts(workspaceId: string) {
  return useQuery({
    queryKey: keys.heldAccounts(workspaceId),
    queryFn: () => api.listHeldAccounts(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useRunCreditHoldSweep(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.runCreditHoldSweep(workspaceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.heldAccounts(workspaceId) }),
  });
}

// 4. Margin matrix
export function useMarginMatrix(workspaceId: string) {
  return useQuery({
    queryKey: keys.marginMatrix(workspaceId),
    queryFn: () => api.getMarginMatrix(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

// 5. Equipment reversal
export function useReversalAudit(workspaceId: string) {
  return useQuery({
    queryKey: keys.reversalAudit(workspaceId),
    queryFn: () => api.listReversalAudit(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useReverseEquipmentSale(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { stockNumber: string; reversalId: string; reason: string; approverId: string }) =>
      api.reverseEquipmentSaleWithApproval(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.reversalAudit(workspaceId) }),
  });
}

// 6. Form 8300 + FET
export function useForm8300Reports(workspaceId: string) {
  return useQuery({
    queryKey: keys.form8300(workspaceId),
    queryFn: () => api.listForm8300Reports(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useFetCategories(workspaceId: string) {
  return useQuery({
    queryKey: keys.fetCategories(workspaceId),
    queryFn: () => api.listFetCategories(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

// 7. AP 3-way match / approval / payment
export function useVendorInvoices(workspaceId: string) {
  return useQuery({
    queryKey: keys.vendorInvoices(workspaceId),
    queryFn: () => api.listVendorInvoices(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useApActions(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.vendorInvoices(workspaceId) });
  return {
    match: useMutation({ mutationFn: api.evaluateThreeWayMatch, onSuccess: invalidate }),
    route: useMutation({ mutationFn: api.routeApInvoiceForApproval, onSuccess: invalidate }),
    pay: useMutation({
      mutationFn: (params: { vendorInvoiceId: string; amount: number; method?: string; reference?: string }) =>
        api.recordApPayment(params),
      onSuccess: invalidate,
    }),
  };
}

// 8. AR receipts desk — cash application (M3.1)
export function useOpenCustomerInvoices(workspaceId: string) {
  return useQuery({
    queryKey: keys.openArInvoices(workspaceId),
    queryFn: () => api.listOpenCustomerInvoices(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useArActions(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: keys.openArInvoices(workspaceId) });
    qc.invalidateQueries({ queryKey: keys.heldAccounts(workspaceId) });
  };
  return {
    pay: useMutation({
      mutationFn: (params: Omit<Parameters<typeof api.recordArPayment>[0], "workspaceId">) =>
        api.recordArPayment({ workspaceId, ...params }),
      onSuccess: invalidate,
    }),
  };
}
