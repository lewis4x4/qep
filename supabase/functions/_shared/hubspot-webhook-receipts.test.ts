import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  claimWebhookReceipt,
  type HubSpotWebhookReceiptEvent,
} from "./hubspot-webhook-receipts.ts";

interface MockQueryError {
  code?: string;
  message: string;
}

interface MockQueryResponse {
  data: Array<{ id: string }> | null;
  error: MockQueryError | null;
}

type Operation = "insert" | "update";

interface MockStep {
  table: string;
  operation: Operation;
  response: MockQueryResponse;
}

class MockQueryBuilder implements PromiseLike<MockQueryResponse> {
  readonly filters: Array<{ op: string; args: unknown[] }> = [];
  payload: Record<string, unknown> | null = null;
  private activeOperation: Operation | null = null;

  constructor(readonly step: MockStep) {}

  insert(payload: Record<string, unknown>): this {
    this.activeOperation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.activeOperation = "update";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ op: "eq", args: [column, value] });
    return this;
  }

  in(column: string, values: string[]): this {
    this.filters.push({ op: "in", args: [column, values] });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.filters.push({ op: "not", args: [column, operator, value] });
    return this;
  }

  select(_columns: string): this {
    return this;
  }

  limit(_count: number): Promise<MockQueryResponse> {
    return Promise.resolve(this.result());
  }

  then<TResult1 = MockQueryResponse, TResult2 = never>(
    onfulfilled?:
      | ((value: MockQueryResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }

  private result(): MockQueryResponse {
    if (this.activeOperation !== this.step.operation) {
      throw new Error(
        `Expected ${this.step.operation} but got ${
          this.activeOperation ?? "none"
        }`,
      );
    }

    return this.step.response;
  }
}

class MockSupabase {
  readonly builders: MockQueryBuilder[] = [];
  private cursor = 0;

  constructor(private readonly steps: MockStep[]) {}

  from(table: string): MockQueryBuilder {
    const step = this.steps[this.cursor];
    if (!step) {
      throw new Error(`No mock step configured for table: ${table}`);
    }
    if (step.table !== table) {
      throw new Error(`Expected table ${step.table}, received ${table}`);
    }

    this.cursor += 1;
    const builder = new MockQueryBuilder(step);
    this.builders.push(builder);
    return builder;
  }
}

function createSupabaseMock(steps: MockStep[]): SupabaseClient {
  return new MockSupabase(steps) as unknown as SupabaseClient;
}

function createWebhookEvent(): HubSpotWebhookReceiptEvent {
  return {
    portalId: 12345,
    objectId: 987,
    subscriptionType: "deal.propertyChange",
    propertyName: "dealstage",
    propertyValue: "appointmentscheduled",
    occurredAt: 1_700_000_000_000,
  };
}

function expectedReceiptKey(event: HubSpotWebhookReceiptEvent): string {
  return [
    event.portalId,
    event.objectId,
    event.subscriptionType,
    event.propertyName,
    event.propertyValue,
    event.occurredAt,
  ].map((part) => String(part).trim().toLowerCase()).join(":");
}

Deno.test("claimWebhookReceipt returns claimed for a brand-new receipt", async () => {
  const event = createWebhookEvent();
  const supabase = createSupabaseMock([
    {
      table: "hubspot_webhook_receipts",
      operation: "insert",
      response: {
        data: [{ id: "new-receipt-id" }],
        error: null,
      },
    },
  ]);

  const claim = await claimWebhookReceipt(supabase, event);

  assertEquals(claim.kind, "claimed");
  assertEquals(claim.receiptId, "new-receipt-id");
  assertEquals(claim.receiptKey, expectedReceiptKey(event));
});

Deno.test("claimWebhookReceipt reclaims previously failed duplicate rows for retry", async () => {
  const event = createWebhookEvent();
  const mock = new MockSupabase([
    {
      table: "hubspot_webhook_receipts",
      operation: "insert",
      response: {
        data: null,
        error: { code: "23505", message: "duplicate key value" },
      },
    },
    {
      table: "hubspot_webhook_receipts",
      operation: "update",
      response: {
        data: [{ id: "retry-receipt-id" }],
        error: null,
      },
    },
  ]);

  const claim = await claimWebhookReceipt(
    mock as unknown as SupabaseClient,
    event,
  );

  assertEquals(claim.kind, "claimed");
  assertEquals(claim.receiptId, "retry-receipt-id");

  const reclaimBuilder = mock.builders[1];
  assertEquals(reclaimBuilder.payload, {
    processing_status: "received",
    error: null,
  });
  assertEquals(reclaimBuilder.filters, [
    { op: "eq", args: ["receipt_key", expectedReceiptKey(event)] },
    {
      op: "in",
      args: ["processing_status", ["received", "skipped_duplicate"]],
    },
    { op: "not", args: ["error", "is", null] },
  ]);
});

Deno.test("claimWebhookReceipt keeps true duplicates as duplicate when no retryable error row exists", async () => {
  const event = createWebhookEvent();
  const supabase = createSupabaseMock([
    {
      table: "hubspot_webhook_receipts",
      operation: "insert",
      response: {
        data: null,
        error: { code: "23505", message: "duplicate key value" },
      },
    },
    {
      table: "hubspot_webhook_receipts",
      operation: "update",
      response: {
        data: [],
        error: null,
      },
    },
  ]);

  const claim = await claimWebhookReceipt(supabase, event);

  assertEquals(claim.kind, "duplicate");
  assertEquals(claim.receiptId, null);
  assertEquals(claim.receiptKey, expectedReceiptKey(event));
});
