import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileWizardStepper, type MobileWizardStep } from "./MobileWizardStepper";

afterEach(cleanup);

function buildSteps(): MobileWizardStep[] {
  return [
    { id: "customer", label: "Customer", status: "done" },
    { id: "equipment", label: "Equipment", status: "done" },
    { id: "configure", label: "Configure", status: "current" },
    { id: "trade-in", label: "Trade-In", status: "available" },
    { id: "pricing", label: "Pricing", status: "available" },
    { id: "promotions", label: "Promotions", status: "locked" },
    { id: "financing", label: "Financing", status: "locked" },
    { id: "details", label: "Details", status: "locked" },
    { id: "review", label: "Review", status: "locked" },
    { id: "document", label: "Document", status: "locked" },
    { id: "send", label: "Send", status: "locked" },
  ];
}

describe("MobileWizardStepper", () => {
  test("renders all steps and marks the current one", () => {
    render(<MobileWizardStepper steps={buildSteps()} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(11);
    const currentButton = screen.getByRole("button", { name: /Configure/i });
    expect(currentButton.getAttribute("aria-current")).toBe("step");
  });

  test("fires onStepClick for non-locked steps and ignores locked", () => {
    let clicked: string | null = null;
    render(
      <MobileWizardStepper
        steps={buildSteps()}
        onStepClick={(id) => {
          clicked = id;
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Pricing/i }));
    expect(clicked).toBe("pricing");

    clicked = null;
    fireEvent.click(screen.getByRole("button", { name: /Financing/i }));
    expect(clicked).toBeNull();
  });

  test("locked steps expose aria-disabled and the disabled attribute", () => {
    render(<MobileWizardStepper steps={buildSteps()} />);
    const locked = screen.getByRole("button", { name: /Financing/i });
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    expect((locked as HTMLButtonElement).disabled).toBe(true);
  });

  test("arrow keys skip over locked steps", () => {
    render(<MobileWizardStepper steps={buildSteps()} />);
    const pricing = screen.getByRole("button", { name: /Pricing/i }) as HTMLButtonElement;
    pricing.focus();
    fireEvent.keyDown(pricing, { key: "ArrowRight" });
    // After Pricing, Promotions/Financing/Details/Review/Document/Send are locked.
    // Focus should stay on Pricing because there is no non-locked next step.
    expect(document.activeElement).toBe(pricing);
  });
});
