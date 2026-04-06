/**
 * Optional structured fields for vendor→shop webhooks beyond PO + raw_text.
 * Validated only when at least one contract key is present (backward compatible).
 */

const CONTRACT_KEYS = [
  "line_items",
  "edi_control_number",
  "vendor_transaction_id",
  "asn_reference",
  "shipment_reference",
  "vendor_message_type",
] as const;

const MAX_LINE_ITEMS = 50;
const MAX_REF_LEN = 500;
const MAX_PART_LEN = 80;

export type VendorInboundLineItemV1 = {
  part_number?: string;
  quantity_shipped?: number;
  unit_of_measure?: string;
  line_reference?: string;
};

export type VendorInboundContractV1 = {
  edi_control_number?: string;
  vendor_transaction_id?: string;
  asn_reference?: string;
  shipment_reference?: string;
  /** e.g. asn, ack, invoice_notice, status */
  vendor_message_type?: string;
  line_items?: VendorInboundLineItemV1[];
};

function trimStr(v: unknown, max: number): string | undefined {
  if (v == null) return undefined;
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function wantsContract(body: Record<string, unknown>): boolean {
  for (const k of CONTRACT_KEYS) {
    if (k in body && body[k] !== undefined) return true;
  }
  return false;
}

function parseLineItems(raw: unknown): VendorInboundLineItemV1[] | string {
  if (!Array.isArray(raw)) return "line_items must be an array";
  if (raw.length > MAX_LINE_ITEMS) {
    return `line_items must have at most ${MAX_LINE_ITEMS} entries`;
  }
  const out: VendorInboundLineItemV1[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (row == null || typeof row !== "object" || Array.isArray(row)) {
      return `line_items[${i}] must be an object`;
    }
    const o = row as Record<string, unknown>;
    const part_number = trimStr(o.part_number, MAX_PART_LEN);
    const unit_of_measure = trimStr(o.unit_of_measure, 32);
    const line_reference = trimStr(o.line_reference, MAX_REF_LEN);
    let quantity_shipped: number | undefined;
    if (o.quantity_shipped != null) {
      const n = Number(o.quantity_shipped);
      if (!Number.isFinite(n) || n < 0) {
        return `line_items[${i}].quantity_shipped must be a non-negative number`;
      }
      quantity_shipped = n;
    }
    const item: VendorInboundLineItemV1 = {};
    if (part_number != null) item.part_number = part_number;
    if (quantity_shipped != null) item.quantity_shipped = quantity_shipped;
    if (unit_of_measure != null) item.unit_of_measure = unit_of_measure;
    if (line_reference != null) item.line_reference = line_reference;
    out.push(item);
  }
  return out;
}

/**
 * When the body includes any optional EDI/API field, validates shape and returns
 * a compact object for `metadata` / fulfillment mirror payloads. If no contract
 * keys are set, returns `{ contract: null }` without error.
 */
export function parseVendorInboundContract(
  body: Record<string, unknown>,
): { contract: VendorInboundContractV1 | null; error: string | null } {
  if (!wantsContract(body)) return { contract: null, error: null };

  const edi_control_number = trimStr(body.edi_control_number, MAX_REF_LEN);
  const vendor_transaction_id = trimStr(body.vendor_transaction_id, MAX_REF_LEN);
  const asn_reference = trimStr(body.asn_reference, MAX_REF_LEN);
  const shipment_reference = trimStr(body.shipment_reference, MAX_REF_LEN);
  const vendor_message_type = trimStr(body.vendor_message_type, 64);

  let line_items: VendorInboundLineItemV1[] | undefined;
  if (body.line_items !== undefined) {
    const parsed = parseLineItems(body.line_items);
    if (typeof parsed === "string") return { contract: null, error: parsed };
    line_items = parsed;
  }

  const contract: VendorInboundContractV1 = {};
  if (edi_control_number != null) contract.edi_control_number = edi_control_number;
  if (vendor_transaction_id != null) {
    contract.vendor_transaction_id = vendor_transaction_id;
  }
  if (asn_reference != null) contract.asn_reference = asn_reference;
  if (shipment_reference != null) contract.shipment_reference = shipment_reference;
  if (vendor_message_type != null) {
    contract.vendor_message_type = vendor_message_type;
  }
  if (line_items != null) contract.line_items = line_items;

  if (Object.keys(contract).length === 0) {
    return {
      contract: null,
      error:
        "Structured vendor fields were present but empty after validation — check types",
    };
  }

  return { contract, error: null };
}
