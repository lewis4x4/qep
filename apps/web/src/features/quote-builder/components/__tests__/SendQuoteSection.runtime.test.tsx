import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SendQuoteSection } from "../SendQuoteSection";

describe("SendQuoteSection runtime behavior", () => {
  test("shows unavailable/disabled state when onSendQuote is missing and does not report success", () => {
    const onSent = mock(() => undefined);

    render(
      <SendQuoteSection
        quotePackageId="pkg-1"
        contactName="Casey"
        onSent={onSent}
      />,
    );

    const sendButton = screen.getByRole("button", { name: "Send Quote" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    expect(
      screen.getByText("Versioned PDF send is not wired for this surface. Use the Send step so a fresh immutable PDF is generated."),
    ).toBeTruthy();
    expect(screen.queryByText(/Quote sent/i)).toBeNull();
    expect(onSent).not.toHaveBeenCalled();
  });

  test("reports sent/version result when callback resolves ok", async () => {
    const onSent = mock(() => undefined);
    const onSendQuote = mock(async () => ({
      ok: true,
      toEmail: "buyer@example.com",
      versionNumber: 7,
    }));

    render(
      <SendQuoteSection
        quotePackageId="pkg-1"
        contactName="Casey"
        onSendQuote={onSendQuote}
        onSent={onSent}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send Quote" }));

    expect(await screen.findByText("Quote sent to buyer@example.com with PDF v7.")).toBeTruthy();

    await waitFor(() => {
      expect(onSendQuote).toHaveBeenCalledTimes(1);
      expect(onSent).toHaveBeenCalledWith({ toEmail: "buyer@example.com", versionNumber: 7 });
    });
  });
});
