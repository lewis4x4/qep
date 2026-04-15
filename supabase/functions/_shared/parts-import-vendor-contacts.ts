/**
 * Vendor contacts workbook parser — e.g. "Company Vendor Contacts 2026.xlsx".
 *
 * Structure per observed file:
 *   Sheet: "Parts Contacts"          — tiered contact tree grouped by company
 *   Sheet: "Parts Ordering Schedule" — per-branch order cadence per vendor
 *   Sheet: "Service Contacts"        — service tier
 *   Sheet: "Admin Contacts"          — billing / AR
 *
 * Company rows are identified by a value in column A (COMPANY) and blank
 * CONTACT NAME; contact rows have blank column A and a CONTACT NAME.
 */

import XLSX from "npm:xlsx@0.18.5";
import { parseStr } from "./parts-import-types.ts";

export interface VendorContactGroup {
  company: string;
  contacts: VendorContactParsed[];
  sheet_source: string;
}

export interface VendorContactParsed {
  contact_name: string;
  phone: string | null;
  ext: string | null;
  cell: string | null;
  email: string | null;
  title: string | null;
  notes: string | null;
  /** Inferred tier: 1 = primary, 2 = escalation, 3 = technical / secondary. */
  tier: number;
  /** sheet origin — parts / service / admin */
  domain: "parts" | "service" | "admin";
}

export interface VendorOrderScheduleParsed {
  vendor_code: string | null;
  vendor_name: string | null;
  branch: string | null;
  frequency: string;
  day_of_week: string | null;
  notes: string | null;
}

export function looksLikeVendorContactsWorkbook(
  workbook: XLSX.WorkBook,
): boolean {
  const names = workbook.SheetNames.map((n) => n.toLowerCase());
  return names.some((n) => n.includes("parts contacts")) ||
    names.some((n) => n.includes("vendor contacts"));
}

/** Flatten a contacts sheet into company-keyed contact lists. */
export function parseContactsSheet(
  sheet: XLSX.WorkSheet,
  domain: "parts" | "service" | "admin",
  sheetName: string,
): VendorContactGroup[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown as unknown[][];

  const groups: VendorContactGroup[] = [];
  let currentCompany: string | null = null;
  let currentGroup: VendorContactGroup | null = null;
  let currentTier = 1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const col = (idx: number) => parseStr(row[idx]);
    const company = col(0);
    const contactName = col(1);
    const phone = col(2);
    const ext = col(3);
    const cell = col(4);
    const email = col(5);
    const title = col(6);
    const notes = col(7);

    // Header / section rows
    if (company && /important contacts/i.test(company)) continue;
    if (company && /^company$/i.test(company) && contactName && /contact name/i.test(contactName)) continue;

    // Company row (starts a new group)
    if (company && (!contactName || /OEM\s*DEALER|ESCALATION|TECHNICAL/i.test(contactName))) {
      // Company row may also contain a first contact in col B
      currentCompany = company;
      currentTier = 1;
      currentGroup = {
        company: currentCompany,
        contacts: [],
        sheet_source: sheetName,
      };
      groups.push(currentGroup);

      // If col B has contact-like content, treat as first contact.
      if (contactName && !/ESCALATION|TECHNICAL/i.test(contactName)) {
        pushContact(currentGroup, {
          contact_name: contactName,
          phone,
          ext,
          cell,
          email,
          title,
          notes,
          tier: currentTier,
          domain,
        });
      } else if (contactName) {
        // Label only — advance tier indicator
        if (/FIRST|PRIMARY/i.test(contactName)) currentTier = 1;
        else if (/ESCALATION|SECOND/i.test(contactName)) currentTier = 2;
        else if (/TECHNICAL|THIRD/i.test(contactName)) currentTier = 3;
      }
      continue;
    }

    // Contact row within current group
    if (!company && currentGroup && contactName) {
      // Label rows with no phone/email — may be tier markers
      if (!phone && !cell && !email) {
        if (/FIRST|PRIMARY/i.test(contactName)) {
          currentTier = 1;
          continue;
        } else if (/ESCALATION|SECOND/i.test(contactName)) {
          currentTier = 2;
          continue;
        } else if (/TECHNICAL|THIRD/i.test(contactName)) {
          currentTier = 3;
          continue;
        }
      }

      pushContact(currentGroup, {
        contact_name: contactName,
        phone,
        ext,
        cell,
        email,
        title,
        notes,
        tier: currentTier,
        domain,
      });
    }
  }

  return groups.filter((g) => g.contacts.length > 0);
}

function pushContact(
  group: VendorContactGroup,
  c: VendorContactParsed,
): void {
  // Dedup by (name, domain)
  if (
    group.contacts.find(
      (x) => x.contact_name === c.contact_name && x.domain === c.domain,
    )
  ) return;
  group.contacts.push(c);
}

/** Parse the "Parts Ordering Schedule" sheet. */
export function parseOrderingScheduleSheet(
  sheet: XLSX.WorkSheet,
): VendorOrderScheduleParsed[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown as unknown[][];

  const result: VendorOrderScheduleParsed[] = [];
  let currentBranch: string | null = null;

  for (const row of rows) {
    const col = (idx: number) => parseStr((row ?? [])[idx]);
    const c0 = col(0);
    const c1 = col(1);
    const c2 = col(2);
    const c3 = col(3);

    // Branch header like "LAKE CITY PARTS ORDERING"
    if (c0 && /parts\s+ordering/i.test(c0) && !c1) {
      currentBranch = c0.replace(/parts\s+ordering/i, "").trim() || null;
      continue;
    }
    if (c0 && /^main\s+lines/i.test(c0)) continue;
    if (c0 && /^vendor\s*#/i.test(c0)) continue; // header
    if (!c0 && !c1) continue;

    const vendorCode = c0;
    const vendorName = c1;
    const frequency = c2 ? c2.toLowerCase() : "on_demand";
    const day = c3 ? c3.toLowerCase() : null;

    result.push({
      vendor_code: vendorCode ?? null,
      vendor_name: vendorName ?? null,
      branch: currentBranch,
      frequency: normalizeFrequency(frequency),
      day_of_week: normalizeDay(day),
      notes: null,
    });
  }

  return result.filter((r) => r.vendor_code || r.vendor_name);
}

function normalizeFrequency(f: string | null): string {
  const s = (f ?? "").toLowerCase();
  if (/daily/.test(s)) return "daily";
  if (/week(?!.*bi)/.test(s)) return "weekly";
  if (/bi.*week|every.*two/.test(s)) return "biweekly";
  if (/month/.test(s)) return "monthly";
  return "on_demand";
}

function normalizeDay(d: string | null): string | null {
  if (!d) return null;
  const s = d.toLowerCase();
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  return days.find((x) => s.includes(x.slice(0, 3))) ?? null;
}
