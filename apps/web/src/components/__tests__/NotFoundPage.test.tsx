import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { mock } from "bun:test";
import { MemoryRouter, Route, Routes } from "react-router-dom";

beforeAll(() => {
  mock.restore();
});

const { NotFoundPage } = await import("@/components/NotFoundPage");

afterEach(cleanup);

describe("NotFoundPage home CTA", () => {
  test("labels the authenticated CTA from the resolved home route", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<NotFoundPage homeHref="/floor" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Back to the floor" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Back to Dashboard" })).toBeNull();
  });
});
