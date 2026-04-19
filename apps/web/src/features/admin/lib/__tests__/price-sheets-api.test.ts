import { beforeEach, describe, expect, mock, test } from "bun:test";

// ── Supabase mock ─────────────────────────────────────────────────────────────
//
// The query chains used in price-sheets-api vary per function:
//   getBrandSheetStatus:  from → select → order          (Promise)
//                         from → select                   (Promise)
//                         from → select → in              (Promise, conditional)
//   getFreightZones:      from → select → eq → order      (Promise)
//   upsertFreightZone:    from → insert/update → [eq] → select → single  (Promise)
//   deleteFreightZone:    from → delete → eq              (Promise)
//
// Strategy: makeChain(data) returns an object that is both chainable (every
// method returns itself or a terminal Promise) and thenable so Promise.all
// resolves it correctly. The mockFrom dispatches by table name so each call
// can return pre-configured data.
// ─────────────────────────────────────────────────────────────────────────────

type ChainResult = { data: unknown; error: null | { message: string } };

function makeChain(result: ChainResult) {
  const resolved = Promise.resolve(result);

  // single() returns the first element as the data value
  const singleResult: ChainResult = {
    data:  Array.isArray(result.data) ? ((result.data as unknown[])[0] ?? null) : result.data,
    error: result.error,
  };

  const chain: Record<string, unknown> = {};
  const METHODS = ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "order", "gte", "lte", "limit", "filter"] as const;
  for (const m of METHODS) {
    chain[m] = () => chain;
  }
  chain["single"] = () => Promise.resolve(singleResult);
  chain["then"]   = resolved.then.bind(resolved);
  chain["catch"]  = resolved.catch.bind(resolved);
  return chain;
}

// Table data registry — set per test before calling the function under test
const tableData: Record<string, ChainResult> = {
  qb_brands:            { data: [], error: null },
  qb_price_sheets:      { data: [], error: null },
  qb_freight_zones:     { data: [], error: null },
  qb_price_sheet_items: { data: [], error: null },
};

const mockFrom = mock((table: string) =>
  makeChain(tableData[table] ?? { data: [], error: null })
);

// Storage + functions mocks for upload pipeline (CP5)
type StorageResult = { data: unknown; error: null | { message: string } };
type FnResult      = { data: unknown; error: null | { message: string } };

const storageState: { upload: StorageResult } = {
  upload: { data: { path: "stub" }, error: null },
};
const fnState: { invoke: FnResult } = {
  invoke: { data: null, error: null },
};

const mockStorageUpload = mock((_path: string, _file: unknown, _opts?: unknown) =>
  Promise.resolve(storageState.upload),
);
const mockStorageRemove = mock((_paths: string[]) =>
  Promise.resolve({ data: [], error: null }),
);
const mockStorageFrom = mock((_bucket: string) => ({
  upload: mockStorageUpload,
  remove: mockStorageRemove,
}));
const mockFunctionsInvoke = mock((_name: string, _opts?: unknown) =>
  Promise.resolve(fnState.invoke),
);

mock.module("@/lib/supabase", () => ({
  supabase: {
    from:      mockFrom,
    storage:   { from: mockStorageFrom },
    functions: { invoke: mockFunctionsInvoke },
  },
}));

const {
  getBrandSheetStatus,
  getFreightZones,
  upsertFreightZone,
  deleteFreightZone,
  uploadAndExtractSheet,
  retryExtract,
  retryPublish,
} = await import("../price-sheets-api");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BRAND_ASV = {
  id: "brand-asv-uuid",
  code: "ASV",
  name: "ASV",
  discount_configured: true,
  has_inbound_freight_key: true,
};

const BRAND_BARKO = {
  id: "brand-barko-uuid",
  code: "BARKO",
  name: "Barko",
  discount_configured: false,
  has_inbound_freight_key: false,
};

const PUBLISHED_SHEET = {
  id: "sheet-uuid-1",
  brand_id: "brand-asv-uuid",
  uploaded_at: "2026-04-01T00:00:00Z",
  status: "published",
};

const FREIGHT_ZONE_ROW = {
  id: "zone-uuid-1",
  workspace_id: "default",
  brand_id: "brand-asv-uuid",
  zone_name: "FL",
  state_codes: ["FL"],
  freight_large_cents: 194200,
  freight_small_cents: 77700,
  effective_from: "2026-01-01",
  effective_to: null,
  created_at: "2026-01-01T00:00:00Z",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("price-sheets-api", () => {
  beforeEach(() => {
    mockFrom.mockClear();
    // Reset table data to empty defaults
    tableData["qb_brands"]            = { data: [], error: null };
    tableData["qb_price_sheets"]      = { data: [], error: null };
    tableData["qb_freight_zones"]     = { data: [], error: null };
    tableData["qb_price_sheet_items"] = { data: [], error: null };
  });

  // ── Test 1: getBrandSheetStatus — brand with a published sheet ─────────────

  test("getBrandSheetStatus: brand with published sheet gets correct status fields", async () => {
    tableData["qb_brands"]       = { data: [BRAND_ASV], error: null };
    tableData["qb_price_sheets"] = { data: [PUBLISHED_SHEET], error: null };
    tableData["qb_freight_zones"] = { data: [{ brand_id: "brand-asv-uuid" }], error: null };
    tableData["qb_price_sheet_items"] = { data: [
      { price_sheet_id: "sheet-uuid-1" },
      { price_sheet_id: "sheet-uuid-1" },
    ], error: null };

    const results = await getBrandSheetStatus();

    expect(results).toHaveLength(1);
    const row = results[0];
    expect(row.brand_id).toBe("brand-asv-uuid");
    expect(row.brand_code).toBe("ASV");
    expect(row.brand_name).toBe("ASV");
    expect(row.has_active_sheet).toBe(true);
    expect(row.active_sheet_version).toBe("v2026.04");
    expect(row.active_sheet_item_count).toBe(2);
    expect(row.last_uploaded_at).toBe("2026-04-01T00:00:00Z");
    expect(row.discount_configured).toBe(true);
    expect(row.has_inbound_freight_key).toBe(true);
    expect(row.freight_zone_count).toBe(1);
    expect(row.pending_review_count).toBe(0);
  });

  // ── Test 2: getBrandSheetStatus — brand with no sheets ────────────────────

  test("getBrandSheetStatus: brand with zero sheets has all status flags false/null", async () => {
    tableData["qb_brands"]       = { data: [BRAND_BARKO], error: null };
    tableData["qb_price_sheets"] = { data: [], error: null };
    tableData["qb_freight_zones"] = { data: [], error: null };
    // qb_price_sheet_items is NOT called when publishedIds is empty

    const results = await getBrandSheetStatus();

    expect(results).toHaveLength(1);
    const row = results[0];
    expect(row.has_active_sheet).toBe(false);
    expect(row.active_sheet_version).toBeNull();
    expect(row.active_sheet_item_count).toBe(0);
    expect(row.last_uploaded_at).toBeNull();
    expect(row.discount_configured).toBe(false);
    expect(row.has_inbound_freight_key).toBe(false);
    expect(row.freight_zone_count).toBe(0);
    expect(row.pending_review_count).toBe(0);
  });

  // ── Test 3: upsertFreightZone routes insert vs update ────────────────────

  test("upsertFreightZone: calls insert when no id, update+eq when id present", async () => {
    // Capture which Supabase methods are called
    const calls: string[] = [];
    const singleRes = { data: FREIGHT_ZONE_ROW, error: null };

    const captureChain: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "delete", "eq", "single", "in", "order"]) {
      captureChain[m] = (...args: unknown[]) => {
        // Record just the method name (args may be complex objects)
        const firstArg = typeof args[0] === "string" ? `(${args[0]})` : "()";
        calls.push(`${m}${firstArg}`);
        if (m === "single") return Promise.resolve(singleRes);
        return captureChain;
      };
    }
    captureChain["then"] = Promise.resolve(singleRes).then.bind(Promise.resolve(singleRes));
    captureChain["catch"] = Promise.resolve(singleRes).catch.bind(Promise.resolve(singleRes));

    mockFrom.mockImplementationOnce((_table: string) => captureChain);

    const insertInput: Parameters<typeof upsertFreightZone>[0] = {
      brand_id:           "brand-asv-uuid",
      zone_name:          "FL",
      state_codes:        ["FL"],
      freight_large_cents: 194200,
      freight_small_cents: 77700,
    };

    const result = await upsertFreightZone(insertInput);
    expect(result).toMatchObject({ ok: true });
    expect(calls.some((c) => c.startsWith("insert"))).toBe(true);
    expect(calls.some((c) => c.startsWith("update"))).toBe(false);

    // Reset for update test
    calls.length = 0;
    mockFrom.mockImplementationOnce((_table: string) => captureChain);

    const updateInput = { ...insertInput, id: "zone-uuid-1" };
    const updateResult = await upsertFreightZone(updateInput);
    expect(updateResult).toMatchObject({ ok: true });
    expect(calls.some((c) => c.startsWith("update"))).toBe(true);
    expect(calls).toContain("eq(id)");
    expect(calls.some((c) => c.startsWith("insert"))).toBe(false);
  });

  // ── Test 4: deleteFreightZone calls delete + eq ───────────────────────────

  test("deleteFreightZone: calls .delete().eq('id', zoneId) and returns ok:true", async () => {
    const calls: Array<[string, unknown]> = [];
    const deleteChain: Record<string, unknown> = {};

    for (const m of ["select", "insert", "update", "delete", "eq", "in", "order"]) {
      deleteChain[m] = (...args: unknown[]) => {
        calls.push([m, args[0]]);
        return deleteChain;
      };
    }
    deleteChain["then"]  = Promise.resolve({ data: null, error: null }).then.bind(Promise.resolve({ data: null, error: null }));
    deleteChain["catch"] = Promise.resolve({ data: null, error: null }).catch.bind(Promise.resolve({ data: null, error: null }));

    mockFrom.mockImplementationOnce((_table: string) => deleteChain);

    const result = await deleteFreightZone("zone-uuid-1");

    expect(result).toMatchObject({ ok: true });
    const methods = calls.map(([m]) => m);
    expect(methods).toContain("delete");
    expect(methods).toContain("eq");
    const eqCall = calls.find(([m]) => m === "eq");
    expect(eqCall?.[1]).toBe("id");
  });

  // ── Test 5: getFreightZones filters by brandId ────────────────────────────

  test("getFreightZones: queries qb_freight_zones filtered to the given brandId", async () => {
    tableData["qb_freight_zones"] = { data: [FREIGHT_ZONE_ROW], error: null };

    const zones = await getFreightZones("brand-asv-uuid");

    expect(mockFrom).toHaveBeenCalledWith("qb_freight_zones");
    expect(zones).toHaveLength(1);
    expect(zones[0].zone_name).toBe("FL");
    expect(zones[0].state_codes).toEqual(["FL"]);
    expect(zones[0].freight_large_cents).toBe(194200);
    expect(zones[0].freight_small_cents).toBe(77700);
  });

  // ── Upload pipeline (CP5) ────────────────────────────────────────────────

  function makeFile(name = "asv-q1.pdf", size = 1024, type = "application/pdf"): File {
    // Build a File; Bun supports the File constructor.
    const content = new Uint8Array(size);
    return new File([content], name, { type });
  }

  const UPLOAD_INPUT = {
    brandId:     "brand-asv-uuid",
    brandCode:   "ASV",
    sheetType:   "price_book" as const,
    workspaceId: "ws-1",
    uploadedBy:  "user-1",
  };

  // ── Test 6: uploadAndExtractSheet happy path (extract + publish) ────────

  test("uploadAndExtractSheet: happy path uploads, inserts, extracts, then publishes", async () => {
    mockStorageUpload.mockClear();
    mockFunctionsInvoke.mockClear();
    storageState.upload = { data: { path: "asv/2026-04/stub.pdf" }, error: null };

    // Two distinct edge-fn responses: extract first, then publish
    mockFunctionsInvoke.mockImplementationOnce((_name: string, _opts?: unknown) =>
      Promise.resolve({
        data: { priceSheetId: "ps-new", status: "extracted", itemsWritten: 42, programsWritten: 3 },
        error: null,
      }),
    );
    mockFunctionsInvoke.mockImplementationOnce((_name: string, _opts?: unknown) =>
      Promise.resolve({
        data: {
          priceSheetId: "ps-new",
          status: "published",
          itemsApplied: 42,
          itemsSkipped: 0,
          programsApplied: 3,
          programsSkipped: 0,
        },
        error: null,
      }),
    );

    // qb_price_sheets insert returns the new row id
    const insertChain: Record<string, unknown> = {};
    for (const m of ["insert", "select"]) {
      insertChain[m] = () => insertChain;
    }
    insertChain["single"] = () => Promise.resolve({ data: { id: "ps-new" }, error: null });
    mockFrom.mockImplementationOnce((_t: string) => insertChain);

    const result = await uploadAndExtractSheet({ ...UPLOAD_INPUT, file: makeFile() });

    expect(result).toMatchObject({
      ok: true,
      priceSheetId:    "ps-new",
      itemsWritten:    42,
      programsWritten: 3,
      itemsApplied:    42,
      programsApplied: 3,
    });
    expect(mockStorageUpload).toHaveBeenCalled();
    // Extract called first
    expect(mockFunctionsInvoke.mock.calls[0]?.[0]).toBe("extract-price-sheet");
    expect(mockFunctionsInvoke.mock.calls[0]?.[1]).toEqual({ body: { priceSheetId: "ps-new" } });
    // Publish called second with auto_approve:true
    expect(mockFunctionsInvoke.mock.calls[1]?.[0]).toBe("publish-price-sheet");
    expect(mockFunctionsInvoke.mock.calls[1]?.[1]).toEqual({
      body: { priceSheetId: "ps-new", auto_approve: true },
    });
  });

  // ── Test 7: uploadAndExtractSheet — storage failure aborts before DB ─────

  test("uploadAndExtractSheet: storage upload failure returns error without inserting row", async () => {
    mockStorageUpload.mockClear();
    mockFromClear();
    mockFunctionsInvoke.mockClear();
    storageState.upload = { data: null, error: { message: "bucket not found" } };

    const result = await uploadAndExtractSheet({ ...UPLOAD_INPUT, file: makeFile() });

    expect(result).toMatchObject({ error: expect.stringContaining("Upload failed") });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  // ── Test 8: extraction failure — returns priceSheetId + phase=extract ──

  test("uploadAndExtractSheet: extraction 4xx returns priceSheetId + phase=extract", async () => {
    mockStorageUpload.mockClear();
    mockFunctionsInvoke.mockClear();
    storageState.upload = { data: { path: "asv/2026-04/stub.pdf" }, error: null };
    mockFunctionsInvoke.mockImplementationOnce((_name: string) =>
      Promise.resolve({ data: null, error: { message: "Claude JSON parse failed" } }),
    );

    const insertChain: Record<string, unknown> = {};
    for (const m of ["insert", "select"]) {
      insertChain[m] = () => insertChain;
    }
    insertChain["single"] = () => Promise.resolve({ data: { id: "ps-failed" }, error: null });
    mockFrom.mockImplementationOnce((_t: string) => insertChain);

    const result = await uploadAndExtractSheet({ ...UPLOAD_INPUT, file: makeFile() });

    expect(result).toMatchObject({
      priceSheetId: "ps-failed",
      error: expect.stringContaining("Extraction failed"),
      phase: "extract",
    });
    // Publish should NOT have been attempted after extract failure
    expect(mockFunctionsInvoke.mock.calls).toHaveLength(1);
  });

  // ── Test 8b: publish failure — extract succeeded, surfaces phase=publish ─

  test("uploadAndExtractSheet: publish failure returns priceSheetId + phase=publish", async () => {
    mockStorageUpload.mockClear();
    mockFunctionsInvoke.mockClear();
    storageState.upload = { data: { path: "asv/2026-04/stub.pdf" }, error: null };

    // Extract succeeds
    mockFunctionsInvoke.mockImplementationOnce((_name: string) =>
      Promise.resolve({
        data: { priceSheetId: "ps-x", status: "extracted", itemsWritten: 10, programsWritten: 0 },
        error: null,
      }),
    );
    // Publish fails
    mockFunctionsInvoke.mockImplementationOnce((_name: string) =>
      Promise.resolve({ data: null, error: { message: "conflict: already publishing" } }),
    );

    const insertChain: Record<string, unknown> = {};
    for (const m of ["insert", "select"]) {
      insertChain[m] = () => insertChain;
    }
    insertChain["single"] = () => Promise.resolve({ data: { id: "ps-x" }, error: null });
    mockFrom.mockImplementationOnce((_t: string) => insertChain);

    const result = await uploadAndExtractSheet({ ...UPLOAD_INPUT, file: makeFile() });

    expect(result).toMatchObject({
      priceSheetId: "ps-x",
      error: expect.stringContaining("Publish failed"),
      phase: "publish",
      // Fix H1: publish-failure result now carries the extract counts forward
      // so a retryPublish() call can restore them on the final success banner.
      extractCounts: { itemsWritten: 10, programsWritten: 0 },
    });
    // Both edge fns should have been called
    expect(mockFunctionsInvoke.mock.calls).toHaveLength(2);
    expect(mockFunctionsInvoke.mock.calls[1]?.[0]).toBe("publish-price-sheet");
  });

  // ── Test 9: client-side validation rejects oversized files ───────────────

  test("uploadAndExtractSheet: rejects files over 25 MB before hitting storage", async () => {
    mockStorageUpload.mockClear();
    mockFunctionsInvoke.mockClear();
    mockFromClear();

    const huge = makeFile("big.pdf", 26 * 1024 * 1024);
    const result = await uploadAndExtractSheet({ ...UPLOAD_INPUT, file: huge });

    expect(result).toMatchObject({ error: expect.stringContaining("25 MB") });
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // ── Test 10: client-side validation rejects unsupported extensions ───────

  test("uploadAndExtractSheet: rejects unsupported file extensions", async () => {
    mockStorageUpload.mockClear();
    const exe = makeFile("malware.exe", 1024, "application/octet-stream");
    const result = await uploadAndExtractSheet({ ...UPLOAD_INPUT, file: exe });

    expect(result).toMatchObject({ error: expect.stringContaining("Unsupported file type") });
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  // ── Fix M1: storage cleanup on DB insert failure ────────────────────────

  test("uploadAndExtractSheet: when qb_price_sheets insert fails, orphaned storage object is removed", async () => {
    mockStorageUpload.mockClear();
    mockStorageRemove.mockClear();
    mockFunctionsInvoke.mockClear();
    storageState.upload = { data: { path: "asv/2026-04/stub.pdf" }, error: null };

    // Make the insert fail
    const insertChain: Record<string, unknown> = {};
    for (const m of ["insert", "select"]) {
      insertChain[m] = () => insertChain;
    }
    insertChain["single"] = () => Promise.resolve({
      data: null,
      error: { message: "duplicate key violates constraint" },
    });
    mockFrom.mockImplementationOnce((_t: string) => insertChain);

    const result = await uploadAndExtractSheet({ ...UPLOAD_INPUT, file: makeFile() });

    expect(result).toMatchObject({
      error: expect.stringContaining("Could not create sheet record"),
    });
    // Storage upload should have fired
    expect(mockStorageUpload).toHaveBeenCalled();
    // And now the orphan cleanup must have fired — exactly one path in the array
    expect(mockStorageRemove).toHaveBeenCalled();
    const removeArgs = mockStorageRemove.mock.calls[0]?.[0];
    expect(Array.isArray(removeArgs)).toBe(true);
    expect(removeArgs).toHaveLength(1);
    // No extract or publish should have been attempted
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  test("uploadAndExtractSheet: storage cleanup failure does not mask the insert error", async () => {
    mockStorageUpload.mockClear();
    mockStorageRemove.mockClear();
    storageState.upload = { data: { path: "x" }, error: null };
    // Storage remove rejects — caller should still see the DB error, not the
    // cleanup error
    mockStorageRemove.mockImplementationOnce(() =>
      Promise.reject(new Error("remove failed")),
    );

    const insertChain: Record<string, unknown> = {};
    for (const m of ["insert", "select"]) {
      insertChain[m] = () => insertChain;
    }
    insertChain["single"] = () => Promise.resolve({
      data: null,
      error: { message: "row-level security policy blocked insert" },
    });
    mockFrom.mockImplementationOnce((_t: string) => insertChain);

    const result = await uploadAndExtractSheet({ ...UPLOAD_INPUT, file: makeFile() });

    expect(result).toMatchObject({
      error: expect.stringContaining("row-level security policy"),
    });
  });

  // ── Fix H1: retry helpers ────────────────────────────────────────────────

  test("retryExtract: invokes extract → publish for an existing priceSheetId without re-uploading", async () => {
    mockStorageUpload.mockClear();
    mockStorageRemove.mockClear();
    mockFrom.mockClear();
    mockFunctionsInvoke.mockClear();

    mockFunctionsInvoke.mockImplementationOnce((_name: string) =>
      Promise.resolve({
        data: { priceSheetId: "ps-retry", status: "extracted", itemsWritten: 15, programsWritten: 1 },
        error: null,
      }),
    );
    mockFunctionsInvoke.mockImplementationOnce((_name: string) =>
      Promise.resolve({
        data: {
          priceSheetId: "ps-retry",
          status: "published",
          itemsApplied: 15,
          itemsSkipped: 0,
          programsApplied: 1,
          programsSkipped: 0,
        },
        error: null,
      }),
    );

    const result = await retryExtract("ps-retry");

    expect(result).toMatchObject({
      ok: true,
      priceSheetId: "ps-retry",
      itemsWritten: 15,
      programsWritten: 1,
      itemsApplied: 15,
      programsApplied: 1,
    });
    // Critical: NO storage upload, NO DB insert, NO storage remove
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockStorageRemove).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    // Both edge fns called in order
    expect(mockFunctionsInvoke.mock.calls[0]?.[0]).toBe("extract-price-sheet");
    expect(mockFunctionsInvoke.mock.calls[1]?.[0]).toBe("publish-price-sheet");
    expect(mockFunctionsInvoke.mock.calls[1]?.[1]).toEqual({
      body: { priceSheetId: "ps-retry", auto_approve: true },
    });
  });

  test("retryPublish: invokes only publish-price-sheet and restores extract counts", async () => {
    mockStorageUpload.mockClear();
    mockFrom.mockClear();
    mockFunctionsInvoke.mockClear();

    mockFunctionsInvoke.mockImplementationOnce((_name: string) =>
      Promise.resolve({
        data: {
          priceSheetId: "ps-pub-retry",
          status: "published",
          itemsApplied: 22,
          itemsSkipped: 2,
          programsApplied: 3,
          programsSkipped: 0,
        },
        error: null,
      }),
    );

    const result = await retryPublish("ps-pub-retry", {
      itemsWritten: 24,
      programsWritten: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      priceSheetId: "ps-pub-retry",
      itemsWritten: 24,         // preserved from extractCounts
      programsWritten: 3,        // preserved from extractCounts
      itemsApplied: 22,          // from this publish
      programsApplied: 3,
    });
    // Only publish was invoked — no re-extract
    expect(mockFunctionsInvoke.mock.calls).toHaveLength(1);
    expect(mockFunctionsInvoke.mock.calls[0]?.[0]).toBe("publish-price-sheet");
    // Still no storage / insert
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("retryExtract: propagates extract failure with phase='extract'", async () => {
    mockFunctionsInvoke.mockClear();
    mockFunctionsInvoke.mockImplementationOnce((_name: string) =>
      Promise.resolve({ data: null, error: { message: "claude timeout" } }),
    );

    const result = await retryExtract("ps-err");

    expect(result).toMatchObject({
      priceSheetId: "ps-err",
      error: expect.stringContaining("Extraction failed"),
      phase: "extract",
    });
    // Publish should NOT have been attempted
    expect(mockFunctionsInvoke.mock.calls).toHaveLength(1);
  });

  test("retryPublish: propagates publish failure with phase='publish' and preserves counts", async () => {
    mockFunctionsInvoke.mockClear();
    mockFunctionsInvoke.mockImplementationOnce((_name: string) =>
      Promise.resolve({ data: null, error: { message: "rls denied" } }),
    );

    const result = await retryPublish("ps-err", { itemsWritten: 7, programsWritten: 0 });

    expect(result).toMatchObject({
      priceSheetId: "ps-err",
      error: expect.stringContaining("Publish failed"),
      phase: "publish",
      extractCounts: { itemsWritten: 7, programsWritten: 0 },
    });
  });
});

// Helper used by CP5 tests; must come after mockFrom is declared.
function mockFromClear() {
  // mock.mockClear() doesn't reset the implementation registered via mock.module,
  // so we only clear call history. The default implementation remains active.
  mockFrom.mockClear();
}
