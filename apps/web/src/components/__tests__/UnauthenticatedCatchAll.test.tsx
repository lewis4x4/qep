import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

mock.module("@/components/LoginPage", () => ({
  LoginPage: ({ authError }: { authError?: string | null }) => (
    <div data-testid="login-page">{authError ?? "login"}</div>
  ),
}));

mock.module("@/components/NotFoundPage", () => ({
  NotFoundPage: ({ audience }: { audience?: string }) => (
    <div data-testid="not-found-page" data-audience={audience ?? "authenticated"} />
  ),
}));

import { UnauthenticatedCatchAll } from "@/components/UnauthenticatedCatchAll";

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

    expect(screen.getByTestId("login-page")).toBeTruthy();
    expect(screen.queryByTestId("not-found-page")).toBeNull();
  });

  test("shows sign-in for forgot-password", () => {
    render(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <Routes>
          <Route path="*" element={<UnauthenticatedCatchAll />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("login-page")).toBeTruthy();
    expect(screen.queryByTestId("not-found-page")).toBeNull();
  });

  test("shows public 404 for unknown routes", () => {
    render(
      <MemoryRouter initialEntries={["/zzz-not-a-page"]}>
        <Routes>
          <Route path="*" element={<UnauthenticatedCatchAll />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("not-found-page").getAttribute("data-audience")).toBe("public");
    expect(screen.queryByTestId("login-page")).toBeNull();
  });
});
