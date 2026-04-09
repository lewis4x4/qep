import { beforeEach, describe, expect, mock, test } from "bun:test";

let workspaceId: string | null = "default";

mock.module("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({
    invalidateQueries: () => undefined,
  }),
}));

mock.module("@/hooks/useMyWorkspaceId", () => ({
  useMyWorkspaceId: () => ({
    data: workspaceId,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
    isSuccess: workspaceId !== null,
  }),
}));

mock.module("@/lib/supabase", () => ({
  supabase: {},
}));

const { usePredictiveKits } = await import("./usePredictiveKits");
const { usePartsAnalytics, useVendorTrends, usePartsVelocityLive } = await import("./usePartsAnalytics");
const { useCrossReferences } = await import("./useCrossReferences");
const { useReplenishQueue } = await import("./useReplenishQueue");
const { useTransferRecommendations } = await import("./useTransferRecommendations");

describe("workspace-scoped parts hooks", () => {
  beforeEach(() => {
    workspaceId = "ws-1";
  });

  test("predictive kits key and enable state use the workspace id string", () => {
    const options = usePredictiveKits() as { queryKey: unknown[]; enabled: boolean };
    expect(options.queryKey).toEqual(["predictive-kits", "ws-1"]);
    expect(options.enabled).toBe(true);
  });

  test("parts analytics queries key on the workspace id", () => {
    expect((usePartsAnalytics() as { queryKey: unknown[] }).queryKey).toEqual(["parts-analytics", "ws-1"]);
    expect((useVendorTrends() as { queryKey: unknown[] }).queryKey).toEqual(["vendor-trends", "ws-1"]);
    expect((usePartsVelocityLive() as { queryKey: unknown[] }).queryKey).toEqual(["parts-velocity", "ws-1"]);
  });

  test("cross references passes only the workspace id through query state", () => {
    const options = useCrossReferences("ABC-123", "branch-9") as { queryKey: unknown[]; enabled: boolean };
    expect(options.queryKey).toEqual(["parts-cross-references", "ABC-123", "branch-9", "ws-1"]);
    expect(options.enabled).toBe(true);
  });

  test("replenish and transfer queues disable when workspace id is missing", () => {
    workspaceId = null;

    const replenish = useReplenishQueue() as { queryKey: unknown[]; enabled: boolean };
    const transfers = useTransferRecommendations() as { queryKey: unknown[]; enabled: boolean };

    expect(replenish.queryKey).toEqual(["replenish-queue", null]);
    expect(replenish.enabled).toBe(false);
    expect(transfers.queryKey).toEqual(["transfer-recommendations", null]);
    expect(transfers.enabled).toBe(false);
  });
});
