import { describe, expect, test } from "bun:test";
import {
  normalizeActionPlayResult,
  normalizeAiPredictionResult,
  normalizeDeadCapitalRows,
  normalizeEmbedBackfillResult,
  normalizeHotMoverRows,
  normalizeIntelligenceSummary,
  normalizeLlmInferenceRunRows,
  normalizeMarginErosionRows,
  normalizePredictivePlays,
  normalizePredictivePlaysSummary,
  normalizePredictivePredictionResult,
  normalizeSeededForecastResult,
  normalizeStockoutRows,
  recoveredAiPredictionResultFromRuns,
} from "./intelligence-api-normalizers";

const stockout = {
  part_number: "P-100",
  branch_code: "LOU",
  description: "Filter",
  on_hand: "1",
  days_of_stock: "2",
  stockout_risk: "critical",
  daily_velocity: "0.5",
  list_price: "25",
};

const play = {
  id: "play-1",
  part_number: "P-100",
  part_description: "Filter",
  projection_window: "90d",
  projected_due_date: "2026-05-20",
  days_until_due: "17",
  probability: "0.8",
  reason: "PM interval",
  signal_type: "ai_inferred",
  recommended_order_qty: "2",
  projected_revenue: "150",
  status: "open",
  suggested_order_by: "2026-05-15",
  customer_name: "Tigercat Logistics",
  machine_make: "Deere",
  machine_model: "333G",
  machine_hours: "1200",
  current_on_hand_across_branches: "4",
  suggested_vendor_name: "Vendor One",
};

describe("parts intelligence API normalizers", () => {
  test("normalizes intelligence summary collections", () => {
    expect(normalizeIntelligenceSummary({
      kpis: {
        total_parts: "100",
        hot_parts: "10",
        dead_parts: "4",
        stockout_critical: "2",
        dead_capital_usd: "5000",
        margin_erosion_parts: "3",
        forecast_coverage: "0.8",
      },
      stockout_heat: [stockout, { branch_code: "bad" }],
      hot_movers: [{
        part_number: "P-200",
        branch_code: "LOU",
        description: "Teeth",
        history_12mo_sales: "12",
        yoy_growth_pct: "0.2",
        on_hand: "5",
        capital_on_hand: "500",
      }],
      dead_capital: [{
        part_number: "P-300",
        branch_code: "LOU",
        description: "Old part",
        on_hand: "10",
        cost_price: "15",
        capital_on_hand: "150",
        dead_pattern: "bad",
      }],
      margin_erosion: [{
        part_number: "P-400",
        branch_code: "LOU",
        list_price: "100",
        cost_price: "70",
        vendor_list_price: "95",
        margin_pct_on_cost: "0.3",
        margin_pct_on_vendor_list: "0.05",
      }],
    })).toEqual({
      kpis: {
        total_parts: 100,
        hot_parts: 10,
        dead_parts: 4,
        stockout_critical: 2,
        dead_capital_usd: 5000,
        margin_erosion_parts: 3,
        forecast_coverage: 0.8,
      },
      stockout_heat: normalizeStockoutRows([stockout]),
      hot_movers: normalizeHotMoverRows([{
        part_number: "P-200",
        branch_code: "LOU",
        description: "Teeth",
        history_12mo_sales: "12",
        yoy_growth_pct: "0.2",
        on_hand: "5",
        capital_on_hand: "500",
      }]),
      dead_capital: [
        {
          part_number: "P-300",
          branch_code: "LOU",
          description: "Old part",
          on_hand: 10,
          cost_price: 15,
          capital_on_hand: 150,
          dead_pattern: "truly_dead",
        },
      ],
      margin_erosion: normalizeMarginErosionRows([{
        part_number: "P-400",
        branch_code: "LOU",
        list_price: "100",
        cost_price: "70",
        vendor_list_price: "95",
        margin_pct_on_cost: "0.3",
        margin_pct_on_vendor_list: "0.05",
      }]),
    });

    expect(normalizeDeadCapitalRows(null)).toEqual([]);
  });

  test("normalizes predictive plays and summary payloads", () => {
    expect(normalizePredictivePlays([
      play,
      { ...play, id: "play-2", projection_window: "bad", signal_type: "bad", status: "bad" },
      { id: "bad", part_number: "P-101" },
    ])).toEqual([
      {
        id: "play-1",
        part_number: "P-100",
        part_description: "Filter",
        projection_window: "90d",
        projected_due_date: "2026-05-20",
        days_until_due: 17,
        probability: 0.8,
        reason: "PM interval",
        signal_type: "ai_inferred",
        recommended_order_qty: 2,
        projected_revenue: 150,
        status: "open",
        suggested_order_by: "2026-05-15",
        customer_name: "Tigercat Logistics",
        machine_make: "Deere",
        machine_model: "333G",
        machine_hours: 1200,
        current_on_hand_across_branches: 4,
        suggested_vendor_name: "Vendor One",
      },
      {
        ...normalizePredictivePlays([play])[0],
        id: "play-2",
        projection_window: "30d",
        signal_type: "manual_curation",
        status: "open",
      },
    ]);

    expect(normalizePredictivePlaysSummary({
      kpis: {
        open_plays: "2",
        plays_due_7d: "1",
        plays_needing_order: "1",
        projected_revenue_90d: "500",
        customers_touched: "2",
      },
      plays: [play],
    })).toEqual({
      kpis: {
        open_plays: 2,
        plays_due_7d: 1,
        plays_needing_order: 1,
        projected_revenue_90d: 500,
        customers_touched: 2,
      },
      plays: normalizePredictivePlays([play]),
    });
  });

  test("normalizes run result payloads", () => {
    expect(normalizeSeededForecastResult({
      ok: true,
      forecasts_written: "12",
      batch_id: "batch-1",
      elapsed_ms: "42",
    })).toEqual({ ok: true, forecasts_written: 12, batch_id: "batch-1", elapsed_ms: 42 });

    expect(normalizePredictivePredictionResult({
      ok: true,
      plays_written: "3",
      machines_scanned: "10",
      elapsed_ms: "55",
    })).toEqual({ ok: true, plays_written: 3, machines_scanned: 10, elapsed_ms: 55 });

    expect(normalizeAiPredictionResult({
      ok: true,
      machines_processed: "2",
      plays_proposed: "5",
      plays_grounded: "4",
      plays_written: "3",
      llm_errors: "1",
      grounding_rejections: "1",
      cost_cents: "9",
      total_tokens_in: "100",
      total_tokens_out: "50",
      elapsed_ms: "123",
      batch_id: "batch-ai",
    })).toEqual({
      ok: true,
      machines_processed: 2,
      plays_proposed: 5,
      plays_grounded: 4,
      plays_written: 3,
      llm_errors: 1,
      grounding_rejections: 1,
      cost_cents: 9,
      total_tokens_in: 100,
      total_tokens_out: 50,
      elapsed_ms: 123,
      batch_id: "batch-ai",
    });
  });

  test("normalizes recovered AI inference rows", () => {
    const rows = normalizeLlmInferenceRunRows([
      {
        fleet_id: "machine-1",
        plays_proposed: "3",
        plays_grounded: "2",
        plays_written: "1",
        tokens_in: "100",
        tokens_out: "50",
        cost_usd_cents: "7",
        elapsed_ms: "1000",
      },
      {
        fleet_id: "machine-2",
        plays_proposed: "2",
        plays_grounded: "2",
        plays_written: "2",
        tokens_in: "80",
        tokens_out: "40",
        cost_usd_cents: "5",
        elapsed_ms: "1500",
      },
    ]);

    expect(recoveredAiPredictionResultFromRuns(rows)).toEqual({
      ok: true,
      machines_processed: 2,
      plays_proposed: 5,
      plays_grounded: 4,
      plays_written: 3,
      llm_errors: 0,
      grounding_rejections: 1,
      cost_cents: 12,
      total_tokens_in: 180,
      total_tokens_out: 90,
      elapsed_ms: 1500,
      batch_id: "recovered-from-gateway-timeout",
    });
  });

  test("normalizes embed backfill and action play results", () => {
    expect(normalizeEmbedBackfillResult({
      ok: true,
      called_by: "user-1",
      elapsed_ms: "42",
      batches: "2",
      rows_embedded: "10",
      rows_skipped: "1",
      rows_errored: "0",
      api_calls: "2",
      rows_remaining: "5",
    })).toEqual({
      ok: true,
      called_by: "user-1",
      elapsed_ms: 42,
      batches: 2,
      rows_embedded: 10,
      rows_skipped: 1,
      rows_errored: 0,
      api_calls: 2,
      rows_remaining: 5,
    });

    expect(normalizeActionPlayResult({
      ok: true,
      play_id: "play-1",
      status: "actioned",
      queue_action: "bad",
      queue_row_id: "queue-1",
    })).toEqual({
      ok: true,
      play_id: "play-1",
      status: "actioned",
      queue_action: "none",
      queue_row_id: "queue-1",
    });
  });

  test("returns safe empty intelligence defaults for malformed inputs", () => {
    expect(normalizeStockoutRows(null)).toEqual([]);
    expect(normalizePredictivePlays(undefined)).toEqual([]);
    expect(normalizeIntelligenceSummary(null)).toEqual({
      kpis: {
        total_parts: 0,
        hot_parts: 0,
        dead_parts: 0,
        stockout_critical: 0,
        dead_capital_usd: 0,
        margin_erosion_parts: 0,
        forecast_coverage: 0,
      },
      stockout_heat: [],
      hot_movers: [],
      dead_capital: [],
      margin_erosion: [],
    });
  });
});
