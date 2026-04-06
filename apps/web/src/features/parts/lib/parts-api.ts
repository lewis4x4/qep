import { supabase } from "@/lib/supabase";

export async function invokeCreateInternalOrder(body: {
  crm_company_id: string;
  order_source?: string;
  notes?: string | null;
  line_items: Array<Record<string, unknown>>;
  fleet_id?: string | null;
  shipping_address?: Record<string, unknown> | null;
}) {
  const { data, error } = await supabase.functions.invoke("parts-order-manager", {
    body: { action: "create_internal_order", ...body },
  });
  if (error) throw error;
  return data as { order: Record<string, unknown> };
}

export async function invokeSubmitInternalOrder(parts_order_id: string) {
  const { data, error } = await supabase.functions.invoke("parts-order-manager", {
    body: { action: "submit_internal_order", parts_order_id },
  });
  if (error) throw error;
  return data as { order: Record<string, unknown>; fulfillment_run_id: string };
}

export async function invokeUpdateInternalOrder(
  parts_order_id: string,
  fields: { notes?: string; order_source?: string; shipping_address?: Record<string, unknown> | null },
) {
  const { data, error } = await supabase.functions.invoke("parts-order-manager", {
    body: { action: "update_internal_order", parts_order_id, ...fields },
  });
  if (error) throw error;
  return data as { order: Record<string, unknown> };
}

export async function invokeUpdateOrderLines(
  parts_order_id: string,
  line_items: Array<Record<string, unknown>>,
) {
  const { data, error } = await supabase.functions.invoke("parts-order-manager", {
    body: { action: "update_order_lines", parts_order_id, line_items },
  });
  if (error) throw error;
  return data as { lines: number };
}

export async function invokeAdvanceStatus(
  parts_order_id: string,
  new_status: string,
  extra?: { tracking_number?: string | null; estimated_delivery?: string | null },
) {
  const { data, error } = await supabase.functions.invoke("parts-order-manager", {
    body: { action: "advance_status", parts_order_id, new_status, ...extra },
  });
  if (error) throw error;
  return data as { order: Record<string, unknown> };
}

export async function invokePickOrderLine(
  parts_order_id: string,
  parts_order_line_id: string,
  branch_id: string,
) {
  const { data, error } = await supabase.functions.invoke("parts-order-manager", {
    body: { action: "pick_order_line", parts_order_id, parts_order_line_id, branch_id },
  });
  if (error) throw error;
  return data as {
    picked: { line_id: string; part_number: string; quantity: number; branch_id: string };
  };
}
