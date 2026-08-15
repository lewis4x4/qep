import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

beforeAll(() => {
  mock.restore();
});

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

const { LoginPage } = await import("@/components/LoginPage");

afterEach(cleanup);

describe("LoginPage forgot-password route", () => {
  test("renders the reset form on /forgot-password", () => {
    render(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <Routes>
          <Route path="/forgot-password" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("forgot-password-form")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Enter your password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign In" })).toBeNull();
  });

  test("renders the normal sign-in form on /login", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("forgot-password-form")).toBeNull();
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
  });

  test("links forgot password to the dedicated reset route", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const forgotPasswordLink = screen.getByRole("link", { name: "Forgot password?" });
    expect(forgotPasswordLink.getAttribute("href")).toBe("/forgot-password");
  });
});
