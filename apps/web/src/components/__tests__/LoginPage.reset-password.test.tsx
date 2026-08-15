import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const onAuthStateChange = mock(() => ({
  data: {
    subscription: {
      unsubscribe: mock(() => undefined),
    },
  },
}));

const getSession = mock(() =>
  Promise.resolve({
    data: {
      session: null,
    },
  }),
);

const signOut = mock(() => Promise.resolve({ error: null }));

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

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange,
      getSession,
      signOut,
    },
  },
}));

const { LoginPage } = await import("@/components/LoginPage");

afterEach(() => {
  cleanup();
  onAuthStateChange.mockClear();
  getSession.mockClear();
  signOut.mockClear();
});

describe("LoginPage reset-password route", () => {
  test("shows the set-new-password form when a recovery session is present", async () => {
    getSession.mockImplementation(() =>
      Promise.resolve({
        data: {
          session: { user: { id: "user-1" } },
        },
      }),
    );

    render(
      <MemoryRouter initialEntries={["/reset-password#access_token=abc&type=recovery"]}>
        <Routes>
          <Route path="/reset-password" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("reset-password-form")).toBeTruthy();
    });
    expect(screen.getByRole("heading", { name: "Set a new password" })).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save new password" })).toBeTruthy();
  });

  test("shows an expired-link state instead of 404 when recovery is missing", async () => {
    render(
      <MemoryRouter initialEntries={["/reset-password"]}>
        <Routes>
          <Route path="/reset-password" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("reset-password-expired")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "Request a new reset link" }).getAttribute("href")).toBe(
      "/forgot-password",
    );
    expect(screen.queryByRole("heading", { name: "We can't find that page" })).toBeNull();
  });
});
