import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";

interface PreferenceRow {
  muted_channel: "sms" | "eight_by_eight" | null;
  muted_until: string | null;
}

interface SupabaseResult<T> {
  data: T;
  error: { message: string } | null;
}

let preferenceReadResult: SupabaseResult<PreferenceRow | null> = {
  data: null,
  error: null,
};
let rpcImplementation: (
  functionName: string,
  args?: Record<string, unknown>,
) => Promise<SupabaseResult<PreferenceRow | null>> = () =>
  Promise.resolve({ data: null, error: null });

const mockPreferenceMaybeSingle = mock(() => Promise.resolve(preferenceReadResult));
const mockPreferenceEq = mock(() => ({ maybeSingle: mockPreferenceMaybeSingle }));
const mockPreferenceSelect = mock(() => ({ eq: mockPreferenceEq }));
const mockFrom = mock(() => ({ select: mockPreferenceSelect }));
const mockRpc = mock((functionName: string, args?: Record<string, unknown>) =>
  rpcImplementation(functionName, args));
const mockToast = mock(() => undefined);

mock.module("@/hooks/useAuth", () => ({
  useAuth: () => ({
    profile: {
      id: "rep-1",
      full_name: "Brian Lewis",
      email: "brian@example.com",
      role: "rep",
      active_workspace_id: "default",
    },
  }),
}));

mock.module("@/hooks/useTheme", () => ({
  useTheme: () => ({
    preference: "system",
    setPreference: () => undefined,
  }),
}));

mock.module("@/components/QbNotificationBell", () => ({
  QbNotificationBell: () => <button type="button" aria-label="Notifications" />,
}));

let radioGroupValue = "";
let radioGroupOnValueChange: ((value: string) => void) | undefined;

mock.module("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: PropsWithChildren<{ onOpenChange?: (open: boolean) => void }>) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: PropsWithChildren<{ asChild?: boolean }>) => children,
  DropdownMenuContent: ({ children }: PropsWithChildren<{ align?: string; className?: string }>) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onClick,
  }: PropsWithChildren<{ disabled?: boolean; onClick?: () => void; className?: string }>) => (
    <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
  ),
  DropdownMenuRadioGroup: ({
    children,
    value,
    onValueChange,
  }: PropsWithChildren<{ value: string; onValueChange: (value: string) => void }>) => {
    radioGroupValue = value;
    radioGroupOnValueChange = onValueChange;
    return <div>{children}</div>;
  },
  DropdownMenuRadioItem: ({
    children,
    value,
    disabled,
  }: PropsWithChildren<{ value: string; disabled?: boolean }>) => (
    <button
      type="button"
      role="radio"
      aria-checked={radioGroupValue === value}
      disabled={disabled}
      onClick={() => radioGroupOnValueChange?.(value)}
    >
      {children}
    </button>
  ),
}));

mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: () => undefined,
    },
    from: mockFrom,
    rpc: mockRpc,
  },
}));

mock.module("@/hooks/use-toast", () => ({
  toast: mockToast,
}));

const { SalesTopHeader } = await import("./SalesTopHeader");

beforeEach(() => {
  preferenceReadResult = { data: null, error: null };
  rpcImplementation = () => Promise.resolve({ data: null, error: null });
  radioGroupValue = "";
  radioGroupOnValueChange = undefined;
  mockPreferenceMaybeSingle.mockClear();
  mockPreferenceEq.mockClear();
  mockPreferenceSelect.mockClear();
  mockFrom.mockClear();
  mockRpc.mockClear();
  mockToast.mockClear();
});

afterEach(cleanup);

describe("SalesTopHeader accessibility", () => {
  async function renderHeader() {
    const view = render(
      <MemoryRouter>
        <SalesTopHeader />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockPreferenceMaybeSingle).toHaveBeenCalledTimes(1));
    await screen.findByRole("radio", { name: "Use SMS + 8x8" });
    return view;
  }

  test("keeps the user menu name aligned with visible initials", async () => {
    await renderHeader();

    const userMenu = screen.getByRole("button", { name: "BL user menu" });
    expect(userMenu.textContent).toContain("BL");
  });

  test("uses dark text on the orange QEP mark for mobile contrast", async () => {
    await renderHeader();

    expect(screen.getByText("QEP").className).toContain("text-slate-950");
  });

  test("keeps a persistent one-tap quick log entry in the sales header", async () => {
    await renderHeader();

    const quickLog = screen.getByRole("link", { name: "Quick log activity" });
    expect(quickLog.getAttribute("href")).toBe("/sales/capture");
    expect(quickLog.className).toContain("min-h-[44px]");
  });

  test("shows the current availability preference as a radio choice", async () => {
    await renderHeader();

    expect(screen.getByRole("radio", { name: "Use SMS + 8x8" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Mute SMS" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: "Mute 8x8" }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("SalesTopHeader availability alert preference", () => {
  async function renderPreferenceHeader() {
    render(
      <MemoryRouter>
        <SalesTopHeader />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockPreferenceMaybeSingle).toHaveBeenCalledTimes(1));
  }

  test("safely re-applies the current choice through the idempotent RPC", async () => {
    await renderPreferenceHeader();
    const allChannels = await screen.findByRole("radio", { name: "Use SMS + 8x8" });

    fireEvent.click(allChannels);

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    expect(mockRpc).toHaveBeenCalledWith(
      "set_sales_availability_alert_mute",
      { p_channel: null, p_muted_until: null },
    );
  });

  test("switches preferences once and adopts the RPC response", async () => {
    preferenceReadResult = {
      data: { muted_channel: "sms", muted_until: null },
      error: null,
    };
    rpcImplementation = () => Promise.resolve({
      data: { muted_channel: "eight_by_eight", muted_until: null },
      error: null,
    });
    await renderPreferenceHeader();

    fireEvent.click(await screen.findByRole("radio", { name: "Mute 8x8" }));

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    expect(mockRpc).toHaveBeenCalledWith(
      "set_sales_availability_alert_mute",
      { p_channel: "eight_by_eight", p_muted_until: null },
    );
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Mute 8x8" }).getAttribute("aria-checked")).toBe("true");
    });
  });

  test("keeps the trigger visibly busy and drops rapid selections while saving", async () => {
    preferenceReadResult = {
      data: { muted_channel: "sms", muted_until: null },
      error: null,
    };
    let resolveRpc: ((result: SupabaseResult<PreferenceRow | null>) => void) | undefined;
    rpcImplementation = () => new Promise((resolve) => {
      resolveRpc = resolve;
    });
    await renderPreferenceHeader();

    fireEvent.click(await screen.findByRole("radio", { name: "Mute 8x8" }));
    const savingTrigger = screen.getByRole("button", {
      name: "BL user menu, saving alert preference",
    });
    expect(savingTrigger.querySelector(".animate-spin")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Use SMS + 8x8" }));

    expect(mockRpc).toHaveBeenCalledTimes(1);
    resolveRpc?.({
      data: { muted_channel: "eight_by_eight", muted_until: null },
      error: null,
    });
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Mute 8x8" }).getAttribute("aria-checked")).toBe("true");
      expect(screen.getByRole("button", { name: "BL user menu" })).toBeTruthy();
    });
  });

  test("uses the server-time reconciler before displaying a temporary mute", async () => {
    preferenceReadResult = {
      data: { muted_channel: "sms", muted_until: "2030-01-01T00:00:00.000Z" },
      error: null,
    };
    rpcImplementation = (functionName) => Promise.resolve({
      data: functionName === "reconcile_my_sales_availability_alert_mute_expiry"
        ? { muted_channel: "sms", muted_until: "2030-01-01T00:00:00.000Z" }
        : { muted_channel: "sms", muted_until: null },
      error: null,
    });

    await renderPreferenceHeader();

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        "reconcile_my_sales_availability_alert_mute_expiry",
      );
    });
    expect(await screen.findByText(/Temporary mute ends/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Mute SMS" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: "Mute SMS" }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
    expect(mockRpc).toHaveBeenLastCalledWith(
      "set_sales_availability_alert_mute",
      { p_channel: "sms", p_muted_until: null },
    );
  });

  test("adopts a server-authoritative expired-mute reconciliation", async () => {
    preferenceReadResult = {
      data: { muted_channel: "sms", muted_until: "2020-01-01T00:00:00.000Z" },
      error: null,
    };
    rpcImplementation = () => Promise.resolve({
      data: { muted_channel: null, muted_until: null },
      error: null,
    });

    await renderPreferenceHeader();

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Use SMS + 8x8" }).getAttribute("aria-checked")).toBe("true");
    });
    expect(screen.queryByText(/Temporary mute ends/)).toBeNull();
  });

  test("fails closed when the preference cannot be loaded", async () => {
    preferenceReadResult = {
      data: null,
      error: { message: "preference read failed" },
    };
    await renderPreferenceHeader();

    expect(await screen.findByText("Retry alert settings")).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
