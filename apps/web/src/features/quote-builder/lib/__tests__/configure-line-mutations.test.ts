import { describe, expect, test } from "bun:test";

import type { QuoteLineItemDraft } from "../../../../../../../shared/qep-moonshot-contracts";

import {
  buildConfigAttachmentLine,
  mergeConfigAttachment,
} from "../configure-line-mutations";

describe("buildConfigAttachmentLine", () => {
  test("defaults title when input is empty", () => {
    const line = buildConfigAttachmentLine("warranty", undefined, 1);
    expect(line.title).toBe("Warranty line");
    expect(line.id).toBe("warranty-1");
    expect(line.sourceCatalog).toBe("manual");
  });

  test("uses catalog source when id is provided", () => {
    const line = buildConfigAttachmentLine("attachment", {
      id: "att-1",
      title: "Bucket",
      unitPrice: 1200,
    }, 2);
    expect(line.sourceCatalog).toBe("qb_attachments");
    expect(line.sourceId).toBe("att-1");
    expect(line.unitPrice).toBe(1200);
  });
});

describe("mergeConfigAttachment", () => {
  test("skips duplicate ids", () => {
    const existing: QuoteLineItemDraft[] = [{
      kind: "part",
      id: "part-1",
      title: "Filter",
      quantity: 1,
      unitPrice: 10,
    } as QuoteLineItemDraft];
    const incoming = buildConfigAttachmentLine("part", { id: "part-1", title: "Filter", unitPrice: 10 }, 1);
    expect(mergeConfigAttachment(existing, incoming)).toHaveLength(1);
  });

  test("appends new line", () => {
    const incoming = buildConfigAttachmentLine("option", { title: "Cab", unitPrice: 500 }, 1);
    const next = mergeConfigAttachment([], incoming);
    expect(next).toHaveLength(1);
    expect(next[0]?.kind).toBe("option");
  });
});
