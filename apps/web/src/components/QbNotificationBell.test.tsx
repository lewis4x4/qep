import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import type { QbNotification } from "@/features/sales/hooks/useQbNotifications";

const mockNavigate = mock((_path: string) => undefined);
const mockMarkRead = mock((_id: string) => undefined);
const mockMarkAllRead = mock(() => undefined);

let notificationsState: QbNotification[] = [];

mock.module("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

mock.module("@/features/sales/hooks/useIsHandheldViewport", () => ({
  useIsHandheldViewport: () => false,
}));

mock.module("@/features/sales/hooks/useQbNotifications", () => ({
  useQbNotifications: () => ({
    notifications: notificationsState,
    unreadCount: notificationsState.filter((notification) => !notification.read_at).length,
    markRead: mockMarkRead,
    markAllRead: mockMarkAllRead,
    isLoading: false,
    error: null,
  }),
}));

mock.module("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: PropsWithChildren<{ open?: boolean; onOpenChange?: (open: boolean) => void }>) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: PropsWithChildren<{ asChild?: boolean }>) => children,
  DropdownMenuContent: ({ children }: PropsWithChildren<{ align?: string; className?: string }>) => (
    <div>{children}</div>
  ),
}));

mock.module("@/components/ui/sheet", () => ({
  Sheet: ({ children }: PropsWithChildren<{ open?: boolean; onOpenChange?: (open: boolean) => void }>) => (
    <div>{children}</div>
  ),
  SheetContent: ({ children }: PropsWithChildren<{ side?: string; className?: string }>) => <div>{children}</div>,
  SheetHeader: ({ children }: PropsWithChildren<{ className?: string }>) => <div>{children}</div>,
  SheetTitle: ({ children, className }: PropsWithChildren<{ className?: string }>) => (
    <div className={className}>{children}</div>
  ),
}));

const { QbNotificationBell } = await import("./QbNotificationBell");

function makeNotification(
  id: string,
  autoSendStatus: "sent" | "failed" | "return_to_rep" | null,
  overrides: Partial<QbNotification> = {},
): QbNotification {
  return {
    id,
    user_id: "rep-1",
    type: "quote_approval_decision",
    title: "Quote approved",
    body: "Quote #QB-1001 was approved. Ready to send to the customer.",
    metadata: {
      deep_link: "/sales/quotes/quote-1",
      ...(autoSendStatus ? { auto_send: { status: autoSendStatus } } : {}),
    },
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  notificationsState = [];
  mockNavigate.mockClear();
  mockMarkRead.mockClear();
  mockMarkAllRead.mockClear();
});

afterEach(cleanup);

describe("QbNotificationBell", () => {
  test("renders auto-sent decision status", () => {
    notificationsState = [
      makeNotification("n-sent", "sent", {
        title: "Quote approved and sent",
        body: "Quote #QB-1001 was approved by Morgan and automatically sent to the customer.",
      }),
    ];

    render(<QbNotificationBell />);

    expect(screen.getByText("Quote approved and sent")).toBeTruthy();
    expect(screen.getByText(/automatically sent to the customer/i)).toBeTruthy();
    expect(screen.getByText("Auto-sent")).toBeTruthy();
  });

  test("renders auto-send attention status", () => {
    notificationsState = [
      makeNotification("n-failed", "failed", {
        title: "Quote approved — auto-send needs attention",
        body: "Quote #QB-1002 was approved, but automatic sending did not complete.",
      }),
    ];

    render(<QbNotificationBell />);

    expect(screen.getByText("Quote approved — auto-send needs attention")).toBeTruthy();
    expect(screen.getByText("Send needs attention")).toBeTruthy();
  });

  test("renders return-to-rep ready-to-send status", () => {
    notificationsState = [makeNotification("n-return", "return_to_rep")];

    render(<QbNotificationBell />);

    expect(screen.getByText("Ready to send")).toBeTruthy();
  });

  test("marks unread notification read and navigates to metadata deep link", () => {
    notificationsState = [makeNotification("n-click", "sent")];

    render(<QbNotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: /Quote approved \(unread\)/i }));

    expect(mockMarkRead).toHaveBeenCalledWith("n-click");
    expect(mockNavigate).toHaveBeenCalledWith("/sales/quotes/quote-1");
  });

  test("marks unread notification read without navigating when deep link is missing", () => {
    notificationsState = [
      makeNotification("n-no-link", "failed", {
        metadata: { auto_send: { status: "failed" } },
      }),
    ];

    render(<QbNotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: /Quote approved \(unread\)/i }));

    expect(mockMarkRead).toHaveBeenCalledWith("n-no-link");
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
