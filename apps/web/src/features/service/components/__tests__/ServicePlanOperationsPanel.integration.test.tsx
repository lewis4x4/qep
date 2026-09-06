import { beforeEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const rpc = mock(async (_name: string, _args: unknown) => ({ data: {}, error: null }));
mock.module("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { id: "manager-1", role: "manager", active_workspace_id: "default" } }) }));
mock.module("@/lib/supabase", () => ({ supabase: { rpc, from: (table: string) => {
 const rows = table === "service_agreement_programs" ? [{id:"program-1",name:"Provisional OEM plan",is_active:false,is_provisional:true,review_status:"draft",review_notes:null}]
  : table === "service_agreements" ? [{id:"agreement-1",contract_number:"AG-1",equipment_id:"machine-1",status:"draft"}] : [];
 const query = {select:()=>query,eq:()=>query,is:()=>query,not:()=>query,order:()=>query,limit:()=>query,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows,error:null}).then(resolve)};
 return query;
} } }));
const { ServicePlanOperationsPanel } = await import("../ServicePlanOperationsPanel");
beforeEach(() => {document.body.innerHTML="";rpc.mockClear();});
test("provisional catalog cannot activate or enroll and rendering never calls a mutation", async () => {
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ServicePlanOperationsPanel /></MemoryRouter></QueryClientProvider>);
 await waitFor(() => expect(screen.getByRole("option",{name:/Provisional OEM plan/})).toBeTruthy());
 fireEvent.change(screen.getByLabelText("PM program"),{target:{value:"program-1"}});
 expect((screen.getByRole("button",{name:"Activate reviewed program"}) as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByRole("button",{name:"Enroll machine"}) as HTMLButtonElement).disabled).toBe(true);
 expect(rpc).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("PM review evidence"),{target:{value:"Owner catalog revision reviewed"}});
 fireEvent.click(screen.getByRole("button",{name:"Record program review"}));
 await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
 expect(rpc.mock.calls[0][0]).toBe("service_plan_review_program");
});
