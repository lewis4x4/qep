// Mock catalog — development stand-in for IntelliDealer REST API responses.
// No real IntelliDealer data structures or endpoints are assumed here.
// Replace this adapter with a real IntelliDealer adapter when VitalEdge confirms API access.

import type {
  CatalogAdapter,
  Machine,
  Attachment,
  MachineCategory,
} from "./intellidealer.types";

const MOCK_MACHINES: Machine[] = [
  {
    stockNumber: "EX-001",
    make: "John Deere",
    model: "35G",
    year: 2024,
    category: "excavator",
    condition: "new",
    hoursOrMiles: 0,
    retailPrice: 54900,
    serialNumber: null,
    available: true,
    specs: [
      { label: "Operating Weight", value: "7,960 lb" },
      { label: "Net Power", value: "24.4 hp" },
      { label: "Max Dig Depth", value: "10 ft 10 in" },
      { label: "Bucket Capacity", value: "0.11 cu yd" },
    ],
  },
  {
    stockNumber: "EX-002",
    make: "John Deere",
    model: "85G",
    year: 2023,
    category: "excavator",
    condition: "new",
    hoursOrMiles: 0,
    retailPrice: 118500,
    serialNumber: null,
    available: true,
    specs: [
      { label: "Operating Weight", value: "19,510 lb" },
      { label: "Net Power", value: "66 hp" },
      { label: "Max Dig Depth", value: "14 ft 8 in" },
      { label: "Bucket Capacity", value: "0.44 cu yd" },
    ],
  },
  {
    stockNumber: "EX-003",
    make: "John Deere",
    model: "135G",
    year: 2023,
    category: "excavator",
    condition: "used",
    hoursOrMiles: 1840,
    retailPrice: 149000,
    serialNumber: "1FF135GXPNF123456",
    available: true,
    specs: [
      { label: "Operating Weight", value: "30,645 lb" },
      { label: "Net Power", value: "103 hp" },
      { label: "Max Dig Depth", value: "19 ft 10 in" },
      { label: "Bucket Capacity", value: "0.81 cu yd" },
    ],
  },
  {
    stockNumber: "WL-001",
    make: "John Deere",
    model: "344L",
    year: 2024,
    category: "wheel_loader",
    condition: "new",
    hoursOrMiles: 0,
    retailPrice: 142000,
    serialNumber: null,
    available: true,
    specs: [
      { label: "Operating Weight", value: "26,820 lb" },
      { label: "Net Power", value: "119 hp" },
      { label: "Bucket Capacity", value: "2.5 cu yd" },
      { label: "Breakout Force", value: "23,400 lb" },
    ],
  },
  {
    stockNumber: "WL-002",
    make: "John Deere",
    model: "524L",
    year: 2023,
    category: "wheel_loader",
    condition: "used",
    hoursOrMiles: 3200,
    retailPrice: 178000,
    serialNumber: "1T0524LXPME654321",
    available: true,
    specs: [
      { label: "Operating Weight", value: "38,580 lb" },
      { label: "Net Power", value: "161 hp" },
      { label: "Bucket Capacity", value: "3.75 cu yd" },
      { label: "Breakout Force", value: "33,100 lb" },
    ],
  },
  {
    stockNumber: "BH-001",
    make: "John Deere",
    model: "310SL",
    year: 2024,
    category: "backhoe",
    condition: "new",
    hoursOrMiles: 0,
    retailPrice: 96500,
    serialNumber: null,
    available: true,
    specs: [
      { label: "Operating Weight", value: "14,630 lb" },
      { label: "Net Power", value: "93 hp" },
      { label: "Max Dig Depth", value: "14 ft 4 in" },
      { label: "Loader Bucket", value: "1.0 cu yd" },
    ],
  },
  {
    stockNumber: "SS-001",
    make: "John Deere",
    model: "320 P-Tier",
    year: 2024,
    category: "skid_steer",
    condition: "new",
    hoursOrMiles: 0,
    retailPrice: 58200,
    serialNumber: null,
    available: true,
    specs: [
      { label: "Operating Weight", value: "7,515 lb" },
      { label: "Net Power", value: "68 hp" },
      { label: "Rated Operating Capacity", value: "2,000 lb" },
      { label: "Tipping Load", value: "4,000 lb" },
    ],
  },
  {
    stockNumber: "SS-002",
    make: "John Deere",
    model: "332 P-Tier",
    year: 2024,
    category: "skid_steer",
    condition: "new",
    hoursOrMiles: 0,
    retailPrice: 68900,
    serialNumber: null,
    available: true,
    specs: [
      { label: "Operating Weight", value: "10,530 lb" },
      { label: "Net Power", value: "100 hp" },
      { label: "Rated Operating Capacity", value: "2,700 lb" },
      { label: "Tipping Load", value: "5,400 lb" },
    ],
  },
  {
    stockNumber: "CTL-001",
    make: "John Deere",
    model: "317G",
    year: 2024,
    category: "compact_track_loader",
    condition: "new",
    hoursOrMiles: 0,
    retailPrice: 65400,
    serialNumber: null,
    available: true,
    specs: [
      { label: "Operating Weight", value: "9,100 lb" },
      { label: "Net Power", value: "68 hp" },
      { label: "Rated Operating Capacity", value: "1,950 lb" },
      { label: "Ground Pressure", value: "4.9 psi" },
    ],
  },
  {
    stockNumber: "CTL-002",
    make: "John Deere",
    model: "333G",
    year: 2023,
    category: "compact_track_loader",
    condition: "used",
    hoursOrMiles: 1120,
    retailPrice: 74500,
    serialNumber: "1T0333GXHME789012",
    available: true,
    specs: [
      { label: "Operating Weight", value: "11,695 lb" },
      { label: "Net Power", value: "100 hp" },
      { label: "Rated Operating Capacity", value: "3,200 lb" },
      { label: "Ground Pressure", value: "5.6 psi" },
    ],
  },
  {
    stockNumber: "TH-001",
    make: "John Deere",
    model: "3515 G-Tier",
    year: 2024,
    category: "telehandler",
    condition: "new",
    hoursOrMiles: 0,
    retailPrice: 87600,
    serialNumber: null,
    available: true,
    specs: [
      { label: "Lift Capacity", value: "5,500 lb" },
      { label: "Max Lift Height", value: "43 ft 4 in" },
      { label: "Net Power", value: "74 hp" },
      { label: "Wheelbase", value: "9 ft 10 in" },
    ],
  },
];

const MOCK_ATTACHMENTS: Attachment[] = [
  // Excavator attachments
  {
    id: "att-ex-bucket-gp",
    name: "General Purpose Bucket (24 in)",
    category: "bucket",
    retailPrice: 2800,
    compatibleCategories: ["excavator"],
  },
  {
    id: "att-ex-bucket-hd",
    name: "Heavy Duty Bucket (30 in)",
    category: "bucket",
    retailPrice: 3900,
    compatibleCategories: ["excavator"],
  },
  {
    id: "att-ex-thumb",
    name: "Hydraulic Thumb",
    category: "thumb",
    retailPrice: 4200,
    compatibleCategories: ["excavator"],
  },
  {
    id: "att-ex-hammer",
    name: "Hydraulic Breaker",
    category: "hammer",
    retailPrice: 8500,
    compatibleCategories: ["excavator"],
  },
  {
    id: "att-ex-auger",
    name: "Auger Drive + 12 in Bit",
    category: "auger",
    retailPrice: 5100,
    compatibleCategories: ["excavator"],
  },
  {
    id: "att-ex-grapple",
    name: "Rotating Grapple",
    category: "grapple",
    retailPrice: 7200,
    compatibleCategories: ["excavator"],
  },
  {
    id: "att-ex-mulcher",
    name: "Forestry Mulching Head",
    category: "mulcher",
    retailPrice: 18500,
    compatibleCategories: ["excavator"],
  },
  {
    id: "att-ex-qc",
    name: "Quick Coupler",
    category: "quick_coupler",
    retailPrice: 2200,
    compatibleCategories: ["excavator"],
  },

  // Wheel loader attachments
  {
    id: "att-wl-bucket-gp",
    name: "General Purpose Bucket",
    category: "bucket",
    retailPrice: 4600,
    compatibleCategories: ["wheel_loader"],
  },
  {
    id: "att-wl-forks",
    name: "Pallet Forks",
    category: "forks",
    retailPrice: 3100,
    compatibleCategories: ["wheel_loader"],
  },
  {
    id: "att-wl-grapple",
    name: "Log Grapple",
    category: "grapple",
    retailPrice: 9800,
    compatibleCategories: ["wheel_loader"],
  },
  {
    id: "att-wl-blade",
    name: "Push Blade",
    category: "blade",
    retailPrice: 5200,
    compatibleCategories: ["wheel_loader"],
  },

  // Skid steer / CTL attachments
  {
    id: "att-ss-bucket-gp",
    name: "General Purpose Bucket (72 in)",
    category: "bucket",
    retailPrice: 1900,
    compatibleCategories: ["skid_steer", "compact_track_loader"],
  },
  {
    id: "att-ss-forks",
    name: "Pallet Forks",
    category: "forks",
    retailPrice: 1600,
    compatibleCategories: ["skid_steer", "compact_track_loader"],
  },
  {
    id: "att-ss-auger",
    name: "Auger Drive + 9 in Bit",
    category: "auger",
    retailPrice: 3800,
    compatibleCategories: ["skid_steer", "compact_track_loader"],
  },
  {
    id: "att-ss-grapple",
    name: "Root Grapple (72 in)",
    category: "grapple",
    retailPrice: 3400,
    compatibleCategories: ["skid_steer", "compact_track_loader"],
  },
  {
    id: "att-ss-blade",
    name: "Angle Blade (84 in)",
    category: "blade",
    retailPrice: 2800,
    compatibleCategories: ["skid_steer", "compact_track_loader"],
  },
  {
    id: "att-ss-mulcher",
    name: "Brush Cutter / Mulcher (72 in)",
    category: "mulcher",
    retailPrice: 8900,
    compatibleCategories: ["skid_steer", "compact_track_loader"],
  },
  {
    id: "att-ss-hammer",
    name: "Hydraulic Breaker",
    category: "hammer",
    retailPrice: 4600,
    compatibleCategories: ["skid_steer", "compact_track_loader"],
  },
  {
    id: "att-ss-qc",
    name: "Quick-Tach Coupler",
    category: "quick_coupler",
    retailPrice: 1100,
    compatibleCategories: ["skid_steer", "compact_track_loader"],
  },

  // Backhoe attachments
  {
    id: "att-bh-bucket-gp",
    name: "General Purpose Digging Bucket (24 in)",
    category: "bucket",
    retailPrice: 2400,
    compatibleCategories: ["backhoe"],
  },
  {
    id: "att-bh-thumb",
    name: "Mechanical Thumb",
    category: "thumb",
    retailPrice: 1800,
    compatibleCategories: ["backhoe"],
  },
  {
    id: "att-bh-auger",
    name: "Auger Drive + 12 in Bit",
    category: "auger",
    retailPrice: 4200,
    compatibleCategories: ["backhoe"],
  },
  {
    id: "att-bh-hammer",
    name: "Hydraulic Breaker",
    category: "hammer",
    retailPrice: 6800,
    compatibleCategories: ["backhoe"],
  },

  // Telehandler attachments
  {
    id: "att-th-forks",
    name: "Pallet Forks (96 in)",
    category: "forks",
    retailPrice: 2600,
    compatibleCategories: ["telehandler"],
  },
  {
    id: "att-th-bucket",
    name: "Carriage Bucket",
    category: "bucket",
    retailPrice: 3800,
    compatibleCategories: ["telehandler"],
  },
  {
    id: "att-th-jib",
    name: "Jib / Hook Attachment",
    category: "other",
    retailPrice: 1900,
    compatibleCategories: ["telehandler"],
  },
];

// Simulate network latency so skeleton loading state renders visibly.
// Remove this delay when swapping in the real IntelliDealer adapter.
function simulatedDelay(ms = 400): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockCatalogAdapter implements CatalogAdapter {
  async getMachines(): Promise<Machine[]> {
    await simulatedDelay();
    return MOCK_MACHINES;
  }

  async getMachine(stockNumber: string): Promise<Machine | null> {
    return Promise.resolve(
      MOCK_MACHINES.find((m) => m.stockNumber === stockNumber) ?? null
    );
  }

  async getAttachments(machineCategory: MachineCategory): Promise<Attachment[]> {
    return Promise.resolve(
      MOCK_ATTACHMENTS.filter((a) =>
        a.compatibleCategories.includes(machineCategory)
      )
    );
  }
}

// Export singleton adapter — swap this export for a real adapter when IntelliDealer is confirmed
export const catalogAdapter: CatalogAdapter = new MockCatalogAdapter();
