import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: {
      full_name: "Brian Lewis",
      email: "brian@example.com",
      role: "rep",
    },
  }),
}));

mock.module("@/hooks/useTheme", () => ({
  useTheme: () => ({
    preference: "system",
    setPreference: () => undefined,
  }),
}));

mock.module("@/components/QbNotificationBell", () => ({
  QbNotificationBell: () => <button type="button" aria-label="Notifications" />,
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: () => undefined,
    },
    rpc: () => Promise.resolve({ error: null }),
  },
}));

mock.module("@/hooks/use-toast", () => ({
  toast: () => undefined,
}));

import { SalesTopHeader } from "./SalesTopHeader";

afterEach(cleanup);

describe("SalesTopHeader accessibility", () => {
  function renderHeader() {
    return render(
      <MemoryRouter>
        <SalesTopHeader />
      </MemoryRouter>,
    );
  }

  test("keeps the user menu name aligned with visible initials", () => {
    renderHeader();

    const userMenu = screen.getByRole("button", { name: "BL user menu" });
    expect(userMenu.textContent).toContain("BL");
  });

  test("uses dark text on the orange QEP mark for mobile contrast", () => {
    renderHeader();

    expect(screen.getByText("QEP").className).toContain("text-slate-950");
  });

  test("keeps a persistent one-tap quick log entry in the sales header", () => {
    renderHeader();

    const quickLog = screen.getByRole("link", { name: "Quick log activity" });
    expect(quickLog.getAttribute("href")).toBe("/sales/capture");
    expect(quickLog.className).toContain("min-h-[44px]");
  });

  test("includes the one-channel availability mute control", async () => {
    const source = await Bun.file(`${import.meta.dir}/SalesTopHeader.tsx`).text();

    expect(source).toContain("Availability alerts");
    expect(source).toContain("Mute SMS");
    expect(source).toContain("Mute 8x8");
    expect(source).toContain("set_sales_availability_alert_mute");
  });
});
