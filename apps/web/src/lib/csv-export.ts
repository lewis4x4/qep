/**
 * CSV Export utility — shared across QRM pages.
 *
 * Uses papaparse to generate CSV from arrays of objects, then triggers
 * a browser download via the Blob + createObjectURL pattern.
 */

import Papa from "papaparse";

// ─── Core download helper ──────────────────────────────────────────────────

export function downloadCsv(data: Record<string, unknown>[], filename: string): void {
  if (data.length === 0) return;
  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Deal export formatter ─────────────────────────────────────────────────

interface DealExportInput {
  id: string;
  name: string;
  amount: number | null;
  stageName?: string | null;
  companyName?: string | null;
  contactName?: string | null;
  assignedRepName?: string | null;
  expectedCloseOn: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  depositStatus: string | null;
  depositAmount: number | null;
  createdAt: string;
}

export function exportDeals(deals: DealExportInput[]): void {
  const rows = deals.map((d) => ({
    "Deal Name": d.name,
    "Amount": d.amount ?? "",
    "Stage": d.stageName ?? "",
    "Company": d.companyName ?? "",
    "Contact": d.contactName ?? "",
    "Assigned Rep": d.assignedRepName ?? "",
    "Expected Close": d.expectedCloseOn ?? "",
    "Next Follow-Up": d.nextFollowUpAt ? new Date(d.nextFollowUpAt).toLocaleDateString() : "",
    "Last Activity": d.lastActivityAt ? new Date(d.lastActivityAt).toLocaleDateString() : "",
    "Deposit Status": d.depositStatus ?? "",
    "Deposit Amount": d.depositAmount ?? "",
    "Created": new Date(d.createdAt).toLocaleDateString(),
    "ID": d.id,
  }));
  downloadCsv(rows, `qep-deals-export-${today()}.csv`);
}

// ─── Contact export formatter ──────────────────────────────────────────────

interface ContactExportInput {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyName?: string | null;
  assignedRepName?: string | null;
  createdAt: string;
}

export function exportContacts(contacts: ContactExportInput[]): void {
  const rows = contacts.map((c) => ({
    "First Name": c.firstName,
    "Last Name": c.lastName,
    "Email": c.email ?? "",
    "Phone": c.phone ?? "",
    "Title": c.title ?? "",
    "Company": c.companyName ?? "",
    "Assigned Rep": c.assignedRepName ?? "",
    "Created": new Date(c.createdAt).toLocaleDateString(),
    "ID": c.id,
  }));
  downloadCsv(rows, `qep-contacts-export-${today()}.csv`);
}

// ─── Company export formatter ──────────────────────────────────────────────

interface CompanyExportInput {
  id: string;
  name: string;
  legacyCustomerNumber?: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  assignedRepName?: string | null;
  createdAt: string;
}

export function exportCompanies(companies: CompanyExportInput[]): void {
  const rows = companies.map((c) => ({
    "Company Name": c.name,
    "IntelliDealer #": c.legacyCustomerNumber ?? "",
    "Address": c.addressLine1 ?? "",
    "City": c.city ?? "",
    "State": c.state ?? "",
    "Postal Code": c.postalCode ?? "",
    "Assigned Rep": c.assignedRepName ?? "",
    "Created": new Date(c.createdAt).toLocaleDateString(),
    "ID": c.id,
  }));
  downloadCsv(rows, `qep-companies-export-${today()}.csv`);
}
