import { beforeEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const create = mock((_payload: Record<string, unknown>, _options?: unknown) => undefined);
mock.module("../../hooks/useServiceJobMutation", () => ({ useCreateServiceJob: () => ({ mutate: create, isPending: false, isError: false }) }));
mock.module("../../hooks/useCustomerSearch", () => ({
 useCustomerSearch: () => ({ data: [{ id: "company-1", name: "Customer A", phone: null, city: null, state: null }], isFetching: false }),
 useCustomerEquipment: () => ({ data: [] }), useEquipmentSearch: () => ({ data: [] }),
}));
const { ServiceIntakePage } = await import("../ServiceIntakePage");
describe("first-seen service intake", () => {
 beforeEach(() => { document.body.innerHTML="";create.mockClear(); });
 test("keeps new machine details in the intake command and displays unverified warranty", () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><ServiceIntakePage /></MemoryRouter></QueryClientProvider>);
  fireEvent.change(screen.getByPlaceholderText("Search by company name or phone number..."),{target:{value:"Customer"}});
  fireEvent.click(screen.getByText("Customer A"));
  fireEvent.click(screen.getByRole("button",{name:"Register a first-seen machine"}));
  for (const [field,value] of Object.entries({make:"Kubota",model:"KX080",serial_number:"FIRST-001",year:"2025"})) fireEvent.change(screen.getByLabelText(`New machine ${field}`),{target:{value}});
  fireEvent.click(screen.getByRole("button",{name:"Use these machine details"}));
  expect(screen.getByLabelText("Machine warranty eligibility").textContent).toContain("Not registered");
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText(/Describe what.s happening/i),{target:{value:"Leak"}});
  fireEvent.change(screen.getByLabelText(/Known.*cause/i),{target:{value:"Check pump"}});
  fireEvent.change(screen.getByLabelText(/Requested.*correction/i),{target:{value:"Inspect"}});
  fireEvent.change(screen.getByLabelText(/Hour meter/i),{target:{value:"12"}});
  fireEvent.change(screen.getByLabelText(/Promised date/i),{target:{value:"2026-09-08T10:00"}});
  fireEvent.click(screen.getByRole("button",{name:"Create Service Job →"}));
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0]).toMatchObject({ machine_id:null, customer_id:"company-1", new_machine:{make:"Kubota",model:"KX080",serial_number:"FIRST-001",year:2025} });
  expect(typeof (create.mock.calls[0][0] as Record<string,unknown>).operation_id).toBe("string");
 });
});
