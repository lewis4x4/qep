import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mock(() => undefined),
    dismiss: mock(() => undefined),
  }),
}));

mock.module("@/lib/supabase-auth-retry", () => ({
  signInWithPasswordWithRetry: mock(() => Promise.resolve({ error: null })),
  signInWithOtpWithRetry: mock(() => Promise.resolve({ error: null })),
  resetPasswordForEmailWithRetry: mock(() => Promise.resolve({ error: null })),
  updatePasswordWithRetry: mock(() => Promise.resolve({ error: null })),
}));

const { UnauthenticatedCatchAll } = await import("@/components/UnauthenticatedCatchAll");

afterEach(cleanup);

describe("UnauthenticatedCatchAll", () => {
  test("shows sign-in for recognized app routes", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="*" element={<UnauthenticatedCatchAll />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "We can't find that page" })).toBeNull();
  });

  test("shows sign-in for forgot-password", () => {
    render(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <Routes>
          <Route path="*" element={<UnauthenticatedCatchAll />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("forgot-password-form")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "We can't find that page" })).toBeNull();
  });

  test("shows public 404 for unknown routes", () => {
    render(
      <MemoryRouter initialEntries={["/zzz-not-a-page"]}>
        <Routes>
          <Route path="*" element={<UnauthenticatedCatchAll />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "We can't find that page" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Welcome back" })).toBeNull();
  });
});
