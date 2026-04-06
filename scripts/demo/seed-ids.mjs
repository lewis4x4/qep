/**
 * Shared demo seed IDs, constants, and helpers for CRM + service/parts seeds.
 * Load env before importing if you need QEP_DEMO_WORKSPACE_ID from .env files.
 */
import { readFileSync, existsSync } from "node:fs";

export function parseDotEnvFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const parsed = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) continue;
    parsed[key] = value;
  }

  return parsed;
}

export function normalizeEnvValue(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Loads .env.demo.local, .env.local, .env into process.env (does not override). */
export function loadDemoEnv() {
  const cwd = process.cwd();
  const envFiles = [`${cwd}/.env.demo.local`, `${cwd}/.env.local`, `${cwd}/.env`];

  for (const filePath of envFiles) {
    if (!existsSync(filePath)) continue;
    const entries = parseDotEnvFile(filePath);
    for (const [key, rawValue] of Object.entries(entries)) {
      if (process.env[key]) continue;
      process.env[key] = normalizeEnvValue(rawValue);
    }
  }
}

loadDemoEnv();

export const DEMO_BATCH_ID = "crm-demo-thursday-2026-04-02";
export const SERVICE_PARTS_SEED_BATCH_ID = "service-parts-seed-2026-04-05";
export const DEMO_WORKSPACE_ID = process.env.QEP_DEMO_WORKSPACE_ID ?? "default";
export const DEMO_PASSWORD = process.env.QEP_DEMO_PASSWORD ?? "QepDemo!2026";
export const PREFER_LOCAL_RUNTIME = process.env.QEP_DEMO_PREFER_LOCAL === "1";

export const DEMO_USERS = [
  {
    key: "owner",
    id: "10000000-0000-4000-8000-000000000001",
    email: "demo.owner@qep-demo.local",
    fullName: "Alex Mercer",
    role: "owner",
  },
  {
    key: "admin",
    id: "10000000-0000-4000-8000-000000000005",
    email: "demo.admin@qep-demo.local",
    fullName: "Jordan Pike",
    role: "admin",
  },
  {
    key: "manager",
    id: "10000000-0000-4000-8000-000000000002",
    email: "demo.manager@qep-demo.local",
    fullName: "Riley Shaw",
    role: "manager",
  },
  {
    key: "rep_primary",
    id: "10000000-0000-4000-8000-000000000003",
    email: "demo.rep@qep-demo.local",
    fullName: "Cole Bryant",
    role: "rep",
  },
  {
    key: "rep_secondary",
    id: "10000000-0000-4000-8000-000000000004",
    email: "demo.rep2@qep-demo.local",
    fullName: "Maya Torres",
    role: "rep",
  },
];

export const STAGE_DEFS = [
  {
    id: "91000000-0000-4000-8000-000000000001",
    name: "Discovery",
    sortOrder: 10,
    probability: 15,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    id: "91000000-0000-4000-8000-000000000002",
    name: "Demo Scheduled",
    sortOrder: 20,
    probability: 35,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    id: "91000000-0000-4000-8000-000000000003",
    name: "Quote Working",
    sortOrder: 30,
    probability: 60,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    id: "91000000-0000-4000-8000-000000000004",
    name: "Negotiation",
    sortOrder: 40,
    probability: 80,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    id: "91000000-0000-4000-8000-000000000005",
    name: "Closed Won",
    sortOrder: 50,
    probability: 100,
    isClosedWon: true,
    isClosedLost: false,
  },
  {
    id: "91000000-0000-4000-8000-000000000006",
    name: "Closed Lost",
    sortOrder: 60,
    probability: 0,
    isClosedWon: false,
    isClosedLost: false,
  },
];

export const DEMO_IDS = {
  customerProfiles: {
    apex: "61000000-0000-4000-8000-000000000001",
  },
  companies: {
    apexHoldings: "11000000-0000-4000-8000-000000000001",
    apexLakeCity: "11000000-0000-4000-8000-000000000002",
    gulfCoast: "11000000-0000-4000-8000-000000000003",
    pineRiver: "11000000-0000-4000-8000-000000000004",
  },
  contacts: {
    mason: "21000000-0000-4000-8000-000000000001",
    hannah: "21000000-0000-4000-8000-000000000002",
    jordan: "21000000-0000-4000-8000-000000000003",
    jordon: "21000000-0000-4000-8000-000000000004",
    elena: "21000000-0000-4000-8000-000000000005",
    wes: "21000000-0000-4000-8000-000000000006",
  },
  contactCompanies: {
    masonApex: "22000000-0000-4000-8000-000000000001",
    hannahApex: "22000000-0000-4000-8000-000000000002",
    jordanGulf: "22000000-0000-4000-8000-000000000003",
    jordonGulf: "22000000-0000-4000-8000-000000000004",
    elenaPine: "22000000-0000-4000-8000-000000000005",
    wesApex: "22000000-0000-4000-8000-000000000006",
  },
  territories: {
    northFlorida: "31000000-0000-4000-8000-000000000001",
    gulfCoast: "31000000-0000-4000-8000-000000000002",
  },
  contactTerritories: {
    masonNorth: "32000000-0000-4000-8000-000000000001",
    hannahNorth: "32000000-0000-4000-8000-000000000002",
    jordanGulf: "32000000-0000-4000-8000-000000000003",
  },
  equipment: {
    apexDozer: "33000000-0000-4000-8000-000000000001",
    apexMulcher: "33000000-0000-4000-8000-000000000002",
    pineSkidSteer: "33000000-0000-4000-8000-000000000003",
  },
  customFieldDefinitions: {
    contactDecisionWindow: "41000000-0000-4000-8000-000000000001",
    contactPreferredChannel: "41000000-0000-4000-8000-000000000002",
    companyFleetPriority: "41000000-0000-4000-8000-000000000003",
    companyServiceRisk: "41000000-0000-4000-8000-000000000004",
  },
  customFieldValues: {
    masonDecisionWindow: "42000000-0000-4000-8000-000000000001",
    masonChannel: "42000000-0000-4000-8000-000000000002",
    apexFleetPriority: "42000000-0000-4000-8000-000000000003",
    pineServiceRisk: "42000000-0000-4000-8000-000000000004",
  },
  deals: {
    barkoPackage: "51000000-0000-4000-8000-000000000001",
    banditDemo: "51000000-0000-4000-8000-000000000002",
    prinothRevision: "51000000-0000-4000-8000-000000000003",
    yanmarRental: "51000000-0000-4000-8000-000000000004",
    asvWon: "51000000-0000-4000-8000-000000000005",
    municipalLost: "51000000-0000-4000-8000-000000000006",
  },
  activities: {
    barkoCall: "71000000-0000-4000-8000-000000000001",
    barkoTaskOverdue: "71000000-0000-4000-8000-000000000002",
    barkoEmailSent: "71000000-0000-4000-8000-000000000003",
    apexNote: "71000000-0000-4000-8000-000000000004",
    banditSmsFailed: "71000000-0000-4000-8000-000000000005",
    banditMeeting: "71000000-0000-4000-8000-000000000006",
    masonManualEmail: "71000000-0000-4000-8000-000000000007",
    prinothTaskOpen: "71000000-0000-4000-8000-000000000008",
    pineCall: "71000000-0000-4000-8000-000000000009",
    gulfTaskDone: "71000000-0000-4000-8000-000000000010",
    apexSmsManual: "71000000-0000-4000-8000-000000000011",
  },
  quotes: {
    barkoQuote: "81000000-0000-4000-8000-000000000001",
  },
  duplicateCandidates: {
    jordanLead: "91000000-0000-4000-8000-000000000010",
  },
  activityTemplates: {
    demoRecap: "88000000-0000-4000-8000-000000000001",
    branchCheckin: "88000000-0000-4000-8000-000000000002",
    rentalTask: "88000000-0000-4000-8000-000000000003",
  },
  hubspotImportRuns: {
    completed: "98000000-0000-4000-8000-000000000001",
    completedWithErrors: "98000000-0000-4000-8000-000000000002",
  },
  hubspotImportErrors: {
    companyStageFallback: "99000000-0000-4000-8000-000000000001",
    activityMissingOwner: "99000000-0000-4000-8000-000000000002",
  },
};

/** Canonical branch slugs — keep in sync across inventory, jobs, branch_config. */
export const SEED_BRANCHES = {
  mainYard: "main-yard",
  lakecity: "lakecity-branch",
  gulfDepot: "gulf-depot",
};

export const SEED_PART_NUMBERS = [
  "HYD-FILTER-01",
  "SEAL-KIT-12",
  "TRACK-PAD-L",
  "TRACK-PAD-R",
  "BLADE-EDGE-60",
  "BUCKET-TEETH-SET",
  "COOLANT-5GAL",
  "BELT-FAN-42",
];

/** Fixed UUIDs for service/parts seed (f000… block). */
export const SERVICE_DEMO_IDS = {
  branchConfig: {
    mainYard: "f0000001-0000-4000-8000-000000000001",
    lakecity: "f0000001-0000-4000-8000-000000000002",
    gulfDepot: "f0000001-0000-4000-8000-000000000003",
  },
  vendors: {
    hydraulic: "f0000002-0000-4000-8000-000000000001",
    oem: "f0000002-0000-4000-8000-000000000002",
    consumables: "f0000002-0000-4000-8000-000000000003",
  },
  /** 24 rows: index 0–23 maps to branch x part grid */
  partsInventory: Array.from({ length: 24 }, (_, i) => {
    const n = String(i + 1).padStart(3, "0");
    return `f0000003-0000-4000-8000-000000000${n}`;
  }),
  jobs: {
    j1: "f0000004-0000-4000-8000-000000000001",
    j2: "f0000004-0000-4000-8000-000000000002",
    j3: "f0000004-0000-4000-8000-000000000003",
    j4: "f0000004-0000-4000-8000-000000000004",
    j5: "f0000004-0000-4000-8000-000000000005",
    j6: "f0000004-0000-4000-8000-000000000006",
    j7: "f0000004-0000-4000-8000-000000000007",
    j8: "f0000004-0000-4000-8000-000000000008",
  },
  requirements: Array.from({ length: 15 }, (_, i) => {
    const n = String(i + 1).padStart(3, "0");
    return `f0000005-0000-4000-8000-000000000${n}`;
  }),
  fulfillmentRuns: {
    open: "f0000006-0000-4000-8000-000000000001",
    submitted: "f0000006-0000-4000-8000-000000000002",
  },
  fulfillmentEvents: [
    "f0000007-0000-4000-8000-000000000001",
    "f0000007-0000-4000-8000-000000000002",
    "f0000007-0000-4000-8000-000000000003",
    "f0000007-0000-4000-8000-000000000004",
    "f0000007-0000-4000-8000-000000000005",
    "f0000007-0000-4000-8000-000000000006",
  ],
  portalCustomers: {
    manager: "f0000008-0000-4000-8000-000000000001",
    viewer: "f0000008-0000-4000-8000-000000000002",
  },
  partsOrders: {
    draft: "f0000009-0000-4000-8000-000000000001",
    submitted: "f0000009-0000-4000-8000-000000000002",
    processing: "f0000009-0000-4000-8000-000000000003",
    shipped: "f0000009-0000-4000-8000-000000000004",
  },
  inventoryOverrides: {
    o1: "f000000a-0000-4000-8000-000000000001",
    o2: "f000000a-0000-4000-8000-000000000002",
  },
  billingStaging: {
    b1: "f000000b-0000-4000-8000-000000000001",
    b2: "f000000b-0000-4000-8000-000000000002",
  },
  vendorEscalationPolicy: "f000000c-0000-4000-8000-000000000001",
  vendorEscalation: "f000000c-0000-4000-8000-000000000002",
  scenarioMachineDownJob: "f000000d-0000-4000-8000-000000000001",
  scenarioTransferJob: "f000000d-0000-4000-8000-000000000002",
};

export function buildTimestamp(offset) {
  const value = new Date();
  value.setSeconds(0, 0);
  value.setDate(value.getDate() + (offset.days ?? 0));
  value.setHours(
    value.getHours() + (offset.hours ?? 0),
    value.getMinutes() + (offset.minutes ?? 0),
    0,
    0,
  );
  return value.toISOString();
}

export function buildDate(daysFromNow) {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() + daysFromNow);
  return value.toISOString().slice(0, 10);
}

export function deliveryMetadata({
  mode,
  provider,
  status,
  destination,
  attemptedAt,
  externalMessageId = null,
  reasonCode = null,
  message = null,
}) {
  return {
    attempted: true,
    mode,
    provider,
    status,
    attemptedAt,
    destination,
    externalMessageId,
    reasonCode,
    message,
  };
}

export function sqlLiteral(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function sqlJson(value) {
  return `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}
