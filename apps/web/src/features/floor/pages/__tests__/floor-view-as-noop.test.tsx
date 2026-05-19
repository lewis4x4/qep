import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

mock.module("@/features/qrm/lib/iron-roles", () => ({
  getEffectiveIronRole: () => ({ role: "iron_owner" }),
}));

mock.module("@/features/qrm/lib/useIronRoleBlend", () => ({
  useIronRoleBlend: () => ({ blend: null }),
}));

mock.module("@/features/floor/hooks/useFloorLayout", () => ({
  useFloorLayout: () => ({
    layout: { widgets: [], quickActions: [], showNarrative: false },
    updatedAt: null,
    isLoading: false,
  }),
}));

mock.module("@/features/floor/hooks/useFloorNarrative", () => ({
  useFloorNarrative: () => ({ text: "Narrative", generatedAt: null, fresh: false }),
}));

mock.module("@/features/floor/hooks/useFloorAttentionSignals", () => ({
  useFloorAttentionSignals: () => ({ data: null }),
}));

const { FloorPage } = await import("../FloorPage");

afterEach(() => {
  cleanup();
});

describe("FloorPage view_as no-op", () => {
  test("ignores /floor?view_as=... and keeps resolved role home", () => {
    render(
      <MemoryRouter initialEntries={["/floor?view_as=iron_advisor"]}>
        <FloorPage
          userId="user-1"
          userRole="admin"
          userFullName="Test User"
          ironRoleFromProfile="iron_owner"
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Owner Home" })).toBeTruthy();
    expect(screen.queryByText("Read-only preview")).toBeNull();
  });
});
