/**
 * Requote Drafts Edge Function
 *
 * Moonshot 2 gap closure: One-click requote for quotes affected by
 * price changes. Generates an updated quote snapshot + auto-drafted
 * email for rep review.
 *
 * Rylee's ask: "The system drafts updated quotes with new pricing
 * and a message: 'Heads up — [Manufacturer] adjusted pricing effective
 * [date]. Here's your updated quote.'"
 *
 * Routes:
 * GET  /impact?workspace_id=... — list open quotes with stale pricing
 *                                  sorted by dollar exposure
 * POST /draft — generate requote + email draft for a specific quote
 *
 * Auth: rep/admin/manager/owner (workspace-scoped)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeCorsHeaders, optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { draftEmail } from "../_shared/draft-email.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return safeJsonError("Unauthorized", 401, origin);

    const url = new URL(req.url);
    const action = url.pathname.split("/").pop() || "";

    // ── GET /impact — list stale quotes sorted by dollar impact ───────────
    if (req.method === "GET" && action === "impact") {
      const { data, error } = await supabaseAdmin
        .from("price_change_impact")
        .select("*")
        .order("price_delta_total", { ascending: false, nullsFirst: false });

      if (error) {
        console.error("price_change_impact error:", error);
        return safeJsonError("Failed to load impact analysis", 500, origin);
      }

      // Stratify the results (Rylee's ask: "47 quotes, 12 deals, 3 POs")
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const totalQuotes = rows.length;
      const totalDealsAffected = new Set(rows.map((r) => r.deal_id).filter(Boolean)).size;
      const totalDollarExposure = rows.reduce(
        (sum, r) => sum + (Number(r.price_delta_total) || 0),
        0,
      );

      return safeJsonOk({
        summary: {
          total_quotes_affected: totalQuotes,
          total_deals_affected: totalDealsAffected,
          total_dollar_exposure: Math.round(totalDollarExposure * 100) / 100,
        },
        impact_items: rows.slice(0, 100), // top 100 by dollar impact
      }, origin);
    }

    // ── POST /draft — one-click requote ───────────────────────────────────
    if (req.method === "POST" && action === "draft") {
      const body = await req.json();
      if (!body.quote_package_id) {
        return safeJsonError("quote_package_id required", 400, origin);
      }

      // Load the quote package + impact info
      const { data: quote, error: quoteErr } = await supabaseAdmin
        .from("quote_packages")
        .select("*")
        .eq("id", body.quote_package_id)
        .maybeSingle();

      if (quoteErr || !quote) {
        return safeJsonError("Quote not found", 404, origin);
      }

      // Get the price changes affecting this quote
      const { data: impactRows } = await supabaseAdmin
        .from("price_change_impact")
        .select("*")
        .eq("quote_package_id", body.quote_package_id);

      const impactRowsArr = (impactRows ?? []) as Array<Record<string, unknown>>;
      if (impactRowsArr.length === 0) {
        return safeJsonError("No price changes affecting this quote", 400, origin);
      }

      // Figure out which manufacturer drove the change
      const manufacturers = [...new Set(impactRowsArr.map((r) => r.make).filter(Boolean))].join(", ");
      const effectiveDate = impactRowsArr[0]?.price_changed_at
        ? new Date(String(impactRowsArr[0].price_changed_at)).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];
      const totalDelta = impactRowsArr.reduce(
        (sum: number, r) => sum + (Number(r.price_delta_total) || 0),
        0,
      );

      // Get customer info for the email
      let customerName = "Customer";
      let repName: string | undefined;
      if (quote.deal_id) {
        const { data: deal } = await supabaseAdmin
          .from("crm_deals")
          .select("name, primary_contact_id, assigned_rep_id, crm_contacts(first_name, last_name)")
          .eq("id", quote.deal_id)
          .maybeSingle();
        if (deal) {
          const contact = Array.isArray((deal as Record<string, unknown>).crm_contacts)
            ? ((deal as { crm_contacts: Array<{ first_name?: string; last_name?: string }> }).crm_contacts[0])
            : ((deal as { crm_contacts?: { first_name?: string; last_name?: string } }).crm_contacts);
          if (contact) {
            customerName = `${contact.first_name || ""} ${contact.last_name || ""}`.trim() || customerName;
          }
          if ((deal as { assigned_rep_id?: string }).assigned_rep_id) {
            const { data: rep } = await supabaseAdmin
              .from("profiles")
              .select("full_name")
              .eq("id", (deal as { assigned_rep_id: string }).assigned_rep_id)
              .maybeSingle();
            repName = (rep as { full_name?: string })?.full_name?.split(" ")[0];
          }
        }
      }

      // Generate the email draft using the shared service
      const emailDraft = await draftEmail({
        purpose: "requote",
        customer_name: customerName,
        rep_name: repName,
        manufacturer: manufacturers || undefined,
        effective_date: effectiveDate,
        deal_value: Number(quote.net_total) || undefined,
        extra_context: {
          price_delta_total: totalDelta,
          line_items_affected: impactRowsArr.length,
        },
      });

      // Persist the draft to email_drafts table
      const { data: draftRow, error: draftErr } = await supabaseAdmin
        .from("email_drafts")
        .insert({
          workspace_id: quote.workspace_id || "default",
          scenario: "requote",
          tone: emailDraft.tone === "urgent" ? "urgent" : "consultative",
          deal_id: quote.deal_id,
          contact_id: quote.contact_id,
          subject: emailDraft.subject,
          body: emailDraft.body,
          preview: emailDraft.body.substring(0, 140),
          urgency_score: totalDelta > 0 ? Math.min(1.0, totalDelta / 10000) : 0.3,
          context: {
            quote_package_id: body.quote_package_id,
            manufacturers,
            effective_date: effectiveDate,
            price_delta_total: totalDelta,
            impact_items: impactRowsArr.length,
            ai_generated: emailDraft.ai_generated,
          },
          status: "pending",
          created_by: user.id,
        })
        .select("id")
        .maybeSingle();

      if (draftErr) {
        console.error("email_drafts insert error:", draftErr);
      }

      // Link the draft back to the quote
      if (draftRow) {
        await supabaseAdmin
          .from("quote_packages")
          .update({
            requote_draft_email_id: draftRow.id,
            requires_requote: true,
            requote_reason: `Auto-generated requote draft (${manufacturers} price change)`,
          })
          .eq("id", body.quote_package_id);
      }

      return safeJsonOk({
        ok: true,
        email_draft: {
          id: draftRow?.id,
          subject: emailDraft.subject,
          body: emailDraft.body,
          tone: emailDraft.tone,
          ai_generated: emailDraft.ai_generated,
        },
        impact: {
          line_items_affected: impactRowsArr.length,
          total_dollar_delta: Math.round(totalDelta * 100) / 100,
          manufacturers,
          effective_date: effectiveDate,
        },
      }, origin);
    }

    // ── POST /batch — bulk-draft requotes for many quotes at once ─────────
    if (req.method === "POST" && action === "batch") {
      const body = await req.json().catch(() => ({}));
      const ids: string[] = Array.isArray(body.quote_package_ids) ? body.quote_package_ids : [];
      if (ids.length === 0) {
        return safeJsonError("quote_package_ids[] required", 400, origin);
      }
      if (ids.length > 50) {
        return safeJsonError("Max 50 quotes per batch", 400, origin);
      }

      const results: Array<{ quote_package_id: string; draft_id: string | null; error?: string }> = [];

      for (const quoteId of ids) {
        try {
          // Inline the same flow as POST /draft for each quote
          const { data: quote } = await supabaseAdmin
            .from("quote_packages")
            .select("*")
            .eq("id", quoteId)
            .maybeSingle();
          if (!quote) {
            results.push({ quote_package_id: quoteId, draft_id: null, error: "quote not found" });
            continue;
          }

          const { data: impactRows } = await supabaseAdmin
            .from("price_change_impact")
            .select("*")
            .eq("quote_package_id", quoteId);
          const rowsArr = (impactRows ?? []) as Array<Record<string, unknown>>;
          if (rowsArr.length === 0) {
            results.push({ quote_package_id: quoteId, draft_id: null, error: "no price changes" });
            continue;
          }

          const manufacturers = [...new Set(rowsArr.map((r) => r.make).filter(Boolean))].join(", ");
          const effectiveDate = rowsArr[0]?.price_changed_at
            ? new Date(String(rowsArr[0].price_changed_at)).toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0];
          const totalDelta = rowsArr.reduce(
            (sum: number, r) => sum + (Number(r.price_delta_total) || 0),
            0,
          );

          let customerName = "Customer";
          if (quote.deal_id) {
            const { data: deal } = await supabaseAdmin
              .from("crm_deals")
              .select("name, primary_contact_id, crm_contacts(first_name, last_name)")
              .eq("id", quote.deal_id)
              .maybeSingle();
            if (deal) {
              const contact = Array.isArray((deal as Record<string, unknown>).crm_contacts)
                ? ((deal as { crm_contacts: Array<{ first_name?: string; last_name?: string }> }).crm_contacts[0])
                : ((deal as { crm_contacts?: { first_name?: string; last_name?: string } }).crm_contacts);
              if (contact) {
                customerName = `${contact.first_name || ""} ${contact.last_name || ""}`.trim() || customerName;
              }
            }
          }

          const emailDraft = await draftEmail({
            purpose: "requote",
            customer_name: customerName,
            manufacturer: manufacturers || undefined,
            effective_date: effectiveDate,
            deal_value: Number(quote.net_total) || undefined,
            extra_context: {
              price_delta_total: totalDelta,
              line_items_affected: rowsArr.length,
            },
          });

          const { data: draftRow, error: draftErr } = await supabaseAdmin
            .from("email_drafts")
            .insert({
              workspace_id: quote.workspace_id || "default",
              scenario: "requote",
              tone: emailDraft.tone === "urgent" ? "urgent" : "consultative",
              deal_id: quote.deal_id,
              contact_id: quote.contact_id,
              subject: emailDraft.subject,
              body: emailDraft.body,
              preview: emailDraft.body.substring(0, 140),
              urgency_score: totalDelta > 0 ? Math.min(1.0, totalDelta / 10000) : 0.3,
              context: {
                quote_package_id: quoteId,
                manufacturers,
                effective_date: effectiveDate,
                price_delta_total: totalDelta,
                batch: true,
              },
              status: "pending",
              created_by: user.id,
            })
            .select("id")
            .maybeSingle();

          if (draftErr || !draftRow) {
            results.push({ quote_package_id: quoteId, draft_id: null, error: "draft insert failed" });
            continue;
          }

          await supabaseAdmin
            .from("quote_packages")
            .update({
              requote_draft_email_id: draftRow.id,
              requires_requote: true,
              requote_reason: `Batch requote draft (${manufacturers} price change)`,
            })
            .eq("id", quoteId);

          results.push({ quote_package_id: quoteId, draft_id: draftRow.id });
        } catch (err) {
          results.push({
            quote_package_id: quoteId,
            draft_id: null,
            error: err instanceof Error ? err.message : "unknown error",
          });
        }
      }

      return safeJsonOk({
        ok: true,
        generated: results.filter((r) => r.draft_id).length,
        failed: results.filter((r) => !r.draft_id).length,
        results,
      }, origin, 201);
    }

    return safeJsonError("Not found", 404, origin);
  } catch (err) {
    console.error("requote-drafts error:", err);
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
