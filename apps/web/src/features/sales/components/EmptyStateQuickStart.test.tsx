import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EmptyStateQuickStart } from "./EmptyStateQuickStart";

afterEach(cleanup);

describe("EmptyStateQuickStart", () => {
  test("renders all four start tiles", () => {
    render(
      <MemoryRouter>
        <EmptyStateQuickStart onLogVisit={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Log a visit")).toBeTruthy();
    expect(screen.getByText("Add a deal")).toBeTruthy();
    expect(screen.getByText("New quote")).toBeTruthy();
    expect(screen.getByText("Find a customer")).toBeTruthy();
  });

  test("fires onLogVisit when the visit tile is tapped", () => {
    let calls = 0;
    render(
      <MemoryRouter>
        <EmptyStateQuickStart onLogVisit={() => (calls += 1)} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Log a visit"));
    expect(calls).toBe(1);
  });
});
