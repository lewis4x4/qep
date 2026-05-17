import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MobileBottomSheet } from "./MobileBottomSheet";

afterEach(cleanup);

function Harness({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open</button>
      <MobileBottomSheet
        open={open}
        onOpenChange={setOpen}
        title="AI Recommendation"
        description="Iron's read on this deal"
      >
        <p>Sheet body content</p>
      </MobileBottomSheet>
    </>
  );
}

describe("MobileBottomSheet", () => {
  test("renders content when open", () => {
    render(<Harness />);
    const root = screen.getByTestId("mobile-bottom-sheet-root");
    expect(root.getAttribute("data-open")).toBe("true");
    expect(screen.getByText("Sheet body content")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  test("closes when backdrop is tapped", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("mobile-bottom-sheet-backdrop"));
    const root = screen.getByTestId("mobile-bottom-sheet-root");
    expect(root.getAttribute("data-open")).toBe("false");
  });

  test("closes when X button is pressed", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const root = screen.getByTestId("mobile-bottom-sheet-root");
    expect(root.getAttribute("data-open")).toBe("false");
  });

  test("closes on Escape key", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "Escape" });
    const root = screen.getByTestId("mobile-bottom-sheet-root");
    expect(root.getAttribute("data-open")).toBe("false");
  });

  test("renders translate-y-full when closed", () => {
    render(<Harness initialOpen={false} />);
    const panel = screen.getByTestId("mobile-bottom-sheet-panel");
    expect(panel.className).toContain("translate-y-full");
  });
});
