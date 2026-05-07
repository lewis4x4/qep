import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QrmAccountDetailMenu } from "../QrmAccountDetailMenu";

afterEach(() => cleanup());

describe("QrmAccountDetailMenu", () => {
  test("renders centralized account navigation with active aria-current", () => {
    render(
      <MemoryRouter initialEntries={["/qrm/accounts/account-1/operating-profile"]}>
        <QrmAccountDetailMenu accountId="account-1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Account detail menu" })).toBeTruthy();
    const activeLinks = screen.getAllByRole("link", { name: /Operating Profile/i });
    expect(activeLinks.some((link) => link.getAttribute("aria-current") === "page")).toBe(true);
    expect(screen.getByRole("button", { name: "Views account views" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More account views" })).toBeTruthy();
  });

  test("opens grouped overflow dialog for compact navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/qrm/accounts/account-1/command"]}>
        <QrmAccountDetailMenu accountId="account-1" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Views account views" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Account views" })).toBeTruthy();
    expect(screen.getAllByText("Foundation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Intelligence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Strategy").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
  });
});
