import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { MobileStickyActionBar } from "./MobileStickyActionBar";

afterEach(cleanup);

describe("MobileStickyActionBar", () => {
  test("renders primary action and clears the BottomTabBar", () => {
    render(
      <MobileStickyActionBar
        primary={<button type="button">Continue</button>}
      />,
    );
    const bar = screen.getByTestId("mobile-sticky-action-bar");
    expect(bar.className).toContain("bottom-16");
    expect(screen.getByRole("button", { name: /Continue/i })).toBeTruthy();
  });

  test("renders secondary action when provided", () => {
    render(
      <MobileStickyActionBar
        secondary={<button type="button">Save Draft</button>}
        primary={<button type="button">Continue</button>}
      />,
    );
    expect(screen.getByRole("button", { name: /Save Draft/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue/i })).toBeTruthy();
  });

  test("renders a progress bar with the correct aria value", () => {
    render(
      <MobileStickyActionBar
        primary={<button type="button">Continue</button>}
        progress={0.45}
      />,
    );
    const progress = screen.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("45");
  });

  test("clamps progress to the [0, 1] range", () => {
    render(
      <MobileStickyActionBar
        primary={<button type="button">Continue</button>}
        progress={1.7}
      />,
    );
    const progress = screen.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("100");
    const fill = progress.firstElementChild as HTMLElement | null;
    expect(fill?.style.width).toBe("100%");
  });
});
