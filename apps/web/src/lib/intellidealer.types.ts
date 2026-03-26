// IntelliDealer API types
// These interfaces define the data shapes expected from the IntelliDealer REST API (VitalEdge).
// The MockCatalogAdapter in mock-catalog.ts fulfills this contract for development.
// When VitalEdge confirms API access, swap in a real adapter — no UI code changes needed.

export type MachineCategory =
  | "excavator"
  | "wheel_loader"
  | "backhoe"
  | "skid_steer"
  | "compact_track_loader"
  | "motor_grader"
  | "dozer"
  | "telehandler"
  | "forklift"
  | "utility_vehicle";

export type MachineCondition = "new" | "used" | "rental";

export type AttachmentCategory =
  | "bucket"
  | "blade"
  | "auger"
  | "forks"
  | "grapple"
  | "hammer"
  | "mulcher"
  | "quick_coupler"
  | "thumb"
  | "tilt_rotator"
  | "other";

export interface MachineSpec {
  label: string;
  value: string;
}

export interface Attachment {
  id: string;
  name: string;
  category: AttachmentCategory;
  retailPrice: number;
  compatibleCategories: MachineCategory[];
}

export interface Machine {
  stockNumber: string;
  make: string;
  model: string;
  year: number;
  category: MachineCategory;
  condition: MachineCondition;
  hoursOrMiles: number | null;
  retailPrice: number;
  serialNumber: string | null;
  specs: MachineSpec[];
  available: boolean;
}

export interface QuoteLineItem {
  type: "machine" | "attachment";
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface QuoteCustomer {
  name: string;
  company: string;
  phone: string;
  email: string;
}

export interface QuoteDraft {
  id: string;
  createdAt: string;
  validUntil: string;
  repName: string;
  repEmail: string;
  customer: QuoteCustomer;
  selectedMachine: Machine | null;
  selectedAttachments: Attachment[];
  notes: string;
}

// Catalog adapter interface — swap implementations to move from mock to IntelliDealer
export interface CatalogAdapter {
  getMachines(): Promise<Machine[]>;
  getMachine(stockNumber: string): Promise<Machine | null>;
  getAttachments(machineCategory: MachineCategory): Promise<Attachment[]>;
}
