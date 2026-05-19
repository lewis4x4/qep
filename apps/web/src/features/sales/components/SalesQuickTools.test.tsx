import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SalesQuickTools } from "./SalesQuickTools";

afterEach(cleanup);

describe("SalesQuickTools", () => {
  test("renders all four tools", () => {
    render(
      <MemoryRouter>
        <SalesQuickTools />
      </MemoryRouter>,
    );
    expect(screen.getByText("Voice note")).toBeTruthy();
    expect(screen.getByText("Prospecting map")).toBeTruthy();
    expect(screen.getByText("Service request")).toBeTruthy();
    expect(screen.getByText("Add customer")).toBeTruthy();
  });

  test("renders the Advisor Quick Tools section header", () => {
    render(
      <MemoryRouter>
        <SalesQuickTools />
      </MemoryRouter>,
    );
    expect(screen.getByText("Advisor Quick Tools")).toBeTruthy();
  });
});
