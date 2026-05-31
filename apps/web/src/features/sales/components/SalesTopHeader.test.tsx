import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";

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
  },
}));

import { SalesTopHeader } from "./SalesTopHeader";

afterEach(cleanup);

describe("SalesTopHeader accessibility", () => {
  test("keeps the user menu name aligned with visible initials", () => {
    render(<SalesTopHeader />);

    const userMenu = screen.getByRole("button", { name: "BL user menu" });
    expect(userMenu.textContent).toContain("BL");
  });

  test("uses dark text on the orange QEP mark for mobile contrast", () => {
    render(<SalesTopHeader />);

    expect(screen.getByText("QEP").className).toContain("text-slate-950");
  });
});
