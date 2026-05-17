import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileIntelligencePanelHost } from "./MobileIntelligencePanelHost";

afterEach(cleanup);

describe("MobileIntelligencePanelHost", () => {
  test("renders a chip for the AI Recommendation panel by default", () => {
    render(
      <MobileIntelligencePanelHost
        intelligencePanel={<div>AI panel body</div>}
      />,
    );
    expect(
      screen.getByRole("button", { name: /AI Recommendation/i }),
    ).toBeTruthy();
  });

  test("renders a Deal Coach chip when dealCoachPanel is provided", () => {
    render(
      <MobileIntelligencePanelHost
        intelligencePanel={<div>AI panel body</div>}
        dealCoachPanel={<div>Coach body</div>}
      />,
    );
    expect(screen.getByRole("button", { name: /Deal Coach/i })).toBeTruthy();
  });

  test("opens the AI Recommendation sheet on chip tap", () => {
    render(
      <MobileIntelligencePanelHost
        intelligencePanel={<div>AI panel body</div>}
      />,
    );
    const chip = screen.getByRole("button", { name: /AI Recommendation/i });
    fireEvent.click(chip);
    expect(screen.getByText("AI panel body")).toBeTruthy();
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(
      "AI Recommendation",
    );
  });

  test("renders extra panels with their own chips and sheets", () => {
    render(
      <MobileIntelligencePanelHost
        intelligencePanel={<div>AI</div>}
        extraPanels={[
          { id: "financing", label: "Financing", content: <div>Financing preview</div> },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Financing/i }));
    expect(screen.getByText("Financing preview")).toBeTruthy();
  });

  test("closes when the user dismisses the sheet", () => {
    render(
      <MobileIntelligencePanelHost
        intelligencePanel={<div>AI panel body</div>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /AI Recommendation/i }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    // After close, the sheet root reports data-open="false"
    const roots = screen.getAllByTestId("mobile-bottom-sheet-root");
    expect(roots.every((node) => node.getAttribute("data-open") === "false")).toBe(
      true,
    );
  });
});
