import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Slice 11 CP3 — integration test for the one-click "Add to QRM" dialog.
 */

mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mock(() => undefined) }),
  toast: mock(() => undefined),
}));

const mockCreateContact = mock(() => Promise.resolve({ id: "contact-new", firstName: "Jane", lastName: "Smith" }));
const mockCreateCompany = mock(() => Promise.resolve({ id: "company-new", name: "Acme Construction" }));

mock.module("@/features/qrm/lib/qrm-router-api", () => ({
  createCrmContactViaRouter: mockCreateContact,
  createCrmCompanyViaRouter: mockCreateCompany,
}));

const { AddToCrmLeadDialog } = await import("../AddToCrmLeadDialog");

const CONTEXT = {
  logId:     "log-1",
  rawPrompt: "Quote an RT-135 for Acme Construction delivering to Ocala with PDI included",
  createdAt: "2026-04-19T10:00:00Z",
};

describe("AddToCrmLeadDialog (integration)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockCreateContact.mockClear();
    mockCreateCompany.mockClear();
  });

  test("renders the raw prompt as read-only context", () => {
    render(
      <AddToCrmLeadDialog
        open={true}
        onOpenChange={() => undefined}
        context={CONTEXT}
      />,
    );
    expect(screen.getByText(/quote an rt-135/i)).toBeTruthy();
    expect(screen.getByText(/original request/i)).toBeTruthy();
  });

  test("Save is disabled until first + last name are filled", async () => {
    render(
      <AddToCrmLeadDialog
        open={true}
        onOpenChange={() => undefined}
        context={CONTEXT}
      />,
    );
    const saveBtn = screen.getByRole("button", { name: /create lead/i });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText(/last name/i),  { target: { value: "Smith" } });
    await waitFor(() => {
      expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  test("Save without company: calls createCrmContactViaRouter with no primaryCompanyId", async () => {
    const onOpenChange = mock(() => undefined);
    render(
      <AddToCrmLeadDialog
        open={true}
        onOpenChange={onOpenChange}
        context={CONTEXT}
      />,
    );

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText(/last name/i),  { target: { value: "Smith" } });
    fireEvent.click(screen.getByRole("button", { name: /create lead/i }));

    await waitFor(() => {
      expect(mockCreateContact).toHaveBeenCalled();
    });
    const callArgs = mockCreateContact.mock.calls[0]?.[0];
    expect(callArgs).toMatchObject({
      firstName: "Jane",
      lastName:  "Smith",
      primaryCompanyId: null,
    });
    // Title should include the prompt
    expect((callArgs as { title: string }).title).toContain("RT-135");
    // Company creator should NOT have been invoked
    expect(mockCreateCompany).not.toHaveBeenCalled();
  });

  test("Save with company: creates company first, then contact with primaryCompanyId", async () => {
    render(
      <AddToCrmLeadDialog
        open={true}
        onOpenChange={() => undefined}
        context={CONTEXT}
      />,
    );

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText(/last name/i),  { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText(/company/i),    { target: { value: "Acme Construction" } });
    fireEvent.click(screen.getByRole("button", { name: /create lead/i }));

    await waitFor(() => {
      expect(mockCreateContact).toHaveBeenCalled();
    });
    expect(mockCreateCompany).toHaveBeenCalledWith({ name: "Acme Construction" });
    const callArgs = mockCreateContact.mock.calls[0]?.[0];
    expect(callArgs).toMatchObject({
      firstName: "Jane",
      lastName:  "Smith",
      primaryCompanyId: "company-new",
    });
  });
});
