import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { AssistantResponseRenderer } from "./AssistantResponseRenderer";

describe("AssistantResponseRenderer links", () => {
  test("renders javascript links as inert text", () => {
    render(<AssistantResponseRenderer content="[x](javascript:alert(1))" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("x")).toBeTruthy();
  });

  test("renders allowed http links as anchors", () => {
    render(<AssistantResponseRenderer content="[QEP](https://example.com/report)" />);

    const link = screen.getByRole("link", { name: "QEP" });
    expect(link.getAttribute("href")).toBe("https://example.com/report");
  });
});
