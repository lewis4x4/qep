import { createClient } from "jsr:@supabase/supabase-js@2";
import { resetServicePartsDemoData, seedServicePartsDemoData } from "./service-parts-demo.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEMO_ADMIN_SECRET = Deno.env.get("DEMO_ADMIN_SECRET");
const DEMO_WORKSPACE_ID = "default";
const DEMO_BATCH_ID = "crm-demo-2026-04-01";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Role = "rep" | "admin" | "manager" | "owner";

type RequestBody = {
  action?: "seed" | "reset";
};

type StageDef = {
  id: string;
  name: string;
  sort_order: number;
  probability: number;
  is_closed_won: boolean;
  is_closed_lost: boolean;
};

const STAGES: StageDef[] = [
  {
    id: "91000000-0000-4000-8000-000000000001",
    name: "Discovery",
    sort_order: 10,
    probability: 15,
    is_closed_won: false,
    is_closed_lost: false,
  },
  {
    id: "91000000-0000-4000-8000-000000000002",
    name: "Demo Scheduled",
    sort_order: 20,
    probability: 35,
    is_closed_won: false,
    is_closed_lost: false,
  },
  {
    id: "91000000-0000-4000-8000-000000000003",
    name: "Quote Working",
    sort_order: 30,
    probability: 60,
    is_closed_won: false,
    is_closed_lost: false,
  },
  {
    id: "91000000-0000-4000-8000-000000000004",
    name: "Negotiation",
    sort_order: 40,
    probability: 80,
    is_closed_won: false,
    is_closed_lost: false,
  },
  {
    id: "91000000-0000-4000-8000-000000000005",
    name: "Closed Won",
    sort_order: 50,
    probability: 100,
    is_closed_won: true,
    is_closed_lost: false,
  },
  {
    id: "91000000-0000-4000-8000-000000000006",
    name: "Closed Lost",
    sort_order: 60,
    probability: 0,
    is_closed_won: false,
    is_closed_lost: true,
  },
];

const IDS = {
  companies: {
    apexHoldings: "11000000-0000-4000-8000-000000000001",
    apexLakeCity: "11000000-0000-4000-8000-000000000002",
    gulfCoast: "11000000-0000-4000-8000-000000000003",
    pineRiver: "11000000-0000-4000-8000-000000000004",
    southernSiteworks: "11000000-0000-4000-8000-000000000005",
    redClayQuarry: "11000000-0000-4000-8000-000000000006",
    coastalUtilities: "11000000-0000-4000-8000-000000000007",
  },
  contacts: {
    mason: "21000000-0000-4000-8000-000000000001",
    hannah: "21000000-0000-4000-8000-000000000002",
    jordan: "21000000-0000-4000-8000-000000000003",
    jordon: "21000000-0000-4000-8000-000000000004",
    elena: "21000000-0000-4000-8000-000000000005",
    wes: "21000000-0000-4000-8000-000000000006",
    dalton: "21000000-0000-4000-8000-000000000007",
    tessa: "21000000-0000-4000-8000-000000000008",
    luke: "21000000-0000-4000-8000-000000000009",
    sara: "21000000-0000-4000-8000-000000000010",
    owen: "21000000-0000-4000-8000-000000000011",
    nick: "21000000-0000-4000-8000-000000000012",
  },
  contactCompanies: {
    masonApex: "22000000-0000-4000-8000-000000000001",
    hannahApex: "22000000-0000-4000-8000-000000000002",
    jordanGulf: "22000000-0000-4000-8000-000000000003",
    jordonGulf: "22000000-0000-4000-8000-000000000004",
    elenaPine: "22000000-0000-4000-8000-000000000005",
    wesApex: "22000000-0000-4000-8000-000000000006",
    daltonSouthern: "22000000-0000-4000-8000-000000000007",
    tessaSouthern: "22000000-0000-4000-8000-000000000008",
    lukeRedClay: "22000000-0000-4000-8000-000000000009",
    saraRedClay: "22000000-0000-4000-8000-000000000010",
    owenCoastal: "22000000-0000-4000-8000-000000000011",
    nickCoastal: "22000000-0000-4000-8000-000000000012",
  },
  equipment: {
    apexDozer: "33000000-0000-4000-8000-000000000001",
    apexMulcher: "33000000-0000-4000-8000-000000000002",
    pineSkidSteer: "33000000-0000-4000-8000-000000000003",
    southernExcavator: "33000000-0000-4000-8000-000000000004",
    redClayWheelLoader: "33000000-0000-4000-8000-000000000005",
    coastalMiniEx: "33000000-0000-4000-8000-000000000006",
    coastalVacTrailer: "33000000-0000-4000-8000-000000000007",
  },
  deals: {
    barkoPackage: "51000000-0000-4000-8000-000000000001",
    banditDemo: "51000000-0000-4000-8000-000000000002",
    prinothRevision: "51000000-0000-4000-8000-000000000003",
    yanmarRental: "51000000-0000-4000-8000-000000000004",
    asvWon: "51000000-0000-4000-8000-000000000005",
    municipalLost: "51000000-0000-4000-8000-000000000006",
    develonExcavator: "51000000-0000-4000-8000-000000000007",
    kobelcoFleet: "51000000-0000-4000-8000-000000000008",
    utilityMiniEx: "51000000-0000-4000-8000-000000000009",
    quarryLoaderUpgrade: "51000000-0000-4000-8000-000000000010",
    vacuumTrailerPackage: "51000000-0000-4000-8000-000000000011",
  },
  activities: {
    barkoCall: "71000000-0000-4000-8000-000000000001",
    barkoTask: "71000000-0000-4000-8000-000000000002",
    barkoEmail: "71000000-0000-4000-8000-000000000003",
    apexNote: "71000000-0000-4000-8000-000000000004",
    banditSms: "71000000-0000-4000-8000-000000000005",
    banditMeeting: "71000000-0000-4000-8000-000000000006",
    masonEmail: "71000000-0000-4000-8000-000000000007",
    prinothTask: "71000000-0000-4000-8000-000000000008",
    pineCall: "71000000-0000-4000-8000-000000000009",
    gulfTask: "71000000-0000-4000-8000-000000000010",
    southernSiteVisit: "71000000-0000-4000-8000-000000000011",
    southernQuoteTask: "71000000-0000-4000-8000-000000000012",
    quarryFinanceCall: "71000000-0000-4000-8000-000000000013",
    quarryEmail: "71000000-0000-4000-8000-000000000014",
    coastalInspection: "71000000-0000-4000-8000-000000000015",
    coastalTask: "71000000-0000-4000-8000-000000000016",
    utilityMiniDemo: "71000000-0000-4000-8000-000000000017",
    utilitySms: "71000000-0000-4000-8000-000000000018",
  },
};

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-demo-admin-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(payload: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return JSON.stringify({
      message: record.message ?? null,
      details: record.details ?? null,
      hint: record.hint ?? null,
      code: record.code ?? null,
    });
  }
  return String(error);
}

function buildTimestamp(offset: { days?: number; hours?: number; minutes?: number }) {
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

function buildDate(daysFromNow: number) {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() + daysFromNow);
  return value.toISOString().slice(0, 10);
}

function demoMetadata(extra: Record<string, unknown> = {}) {
  return {
    demoSeedBatchId: DEMO_BATCH_ID,
    demoCleanupSafe: true,
    ...extra,
  };
}

async function deleteByIds(table: string, ids: string[]) {
  if (!ids.length) return;
  const { error } = await admin.from(table).delete().in("id", ids);
  if (error) throw error;
}

async function purgeVoiceCaptures() {
  const { data: captures, error: captureError } = await admin
    .from("voice_captures")
    .select("id, audio_storage_path");
  if (captureError) throw captureError;

  const paths = (captures ?? [])
    .map((capture) => capture.audio_storage_path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);

  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100);
    const { error: removeError } = await admin.storage.from("voice-recordings").remove(batch);
    if (removeError) {
      console.error("[demo-admin] voice recording remove failed:", removeError.message);
    }
  }

  const { error: deleteError } = await admin.from("voice_captures").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (deleteError) throw deleteError;

  return { deletedCaptures: captures?.length ?? 0, deletedFiles: paths.length };
}

async function resolveAssignees() {
  const { data, error } = await admin
    .from("profiles")
    .select("id, role")
    .in("role", ["rep", "admin", "manager", "owner"])
    .eq("is_active", true);
  if (error) throw error;

  const byRole = new Map<Role, string[]>();
  for (const role of ["rep", "admin", "manager", "owner"] as Role[]) {
    byRole.set(role, []);
  }

  for (const row of data ?? []) {
    const role = row.role as Role | null;
    if (!role || !byRole.has(role)) continue;
    byRole.get(role)!.push(row.id);
  }

  const anyUserId =
    byRole.get("rep")?.[0] ??
    byRole.get("manager")?.[0] ??
    byRole.get("admin")?.[0] ??
    byRole.get("owner")?.[0] ??
    null;

  if (!anyUserId) {
    throw new Error("No active operator profiles are available for QRM demo assignments.");
  }

  return {
    repPrimary: byRole.get("rep")?.[0] ?? anyUserId,
    repSecondary: byRole.get("rep")?.[1] ?? byRole.get("manager")?.[0] ?? anyUserId,
    manager: byRole.get("manager")?.[0] ?? byRole.get("admin")?.[0] ?? anyUserId,
  };
}

async function ensureDealStages() {
  const { data: existing, error: existingError } = await admin
    .from("crm_deal_stages")
    .select("id, name")
    .eq("workspace_id", DEMO_WORKSPACE_ID)
    .in("name", STAGES.map((stage) => stage.name));
  if (existingError) throw existingError;

  const existingNames = new Set((existing ?? []).map((row) => row.name));
  const missing = STAGES.filter((stage) => !existingNames.has(stage.name));

  if (missing.length > 0) {
    const { error: insertError } = await admin.from("crm_deal_stages").insert(
      missing.map((stage) => ({
        ...stage,
        workspace_id: DEMO_WORKSPACE_ID,
      })),
    );
    if (insertError) throw insertError;
  }

  const { data: refreshed, error: refreshedError } = await admin
    .from("crm_deal_stages")
    .select("id, name")
    .eq("workspace_id", DEMO_WORKSPACE_ID)
    .in("name", STAGES.map((stage) => stage.name));
  if (refreshedError) throw refreshedError;

  return Object.fromEntries((refreshed ?? []).map((row) => [row.name, row.id]));
}

async function resetDemoData() {
  await resetServicePartsDemoData(admin, deleteByIds);
  await deleteByIds("crm_activities", Object.values(IDS.activities));
  await deleteByIds("crm_deals", Object.values(IDS.deals));
  await deleteByIds("crm_equipment", Object.values(IDS.equipment));
  await deleteByIds("crm_contact_companies", Object.values(IDS.contactCompanies));
  await deleteByIds("crm_contacts", Object.values(IDS.contacts));
  await deleteByIds("crm_companies", Object.values(IDS.companies));
}

async function seedDemoData() {
  const assignees = await resolveAssignees();
  const stages = await ensureDealStages();

  const timestamps = {
    twoDaysAgo: buildTimestamp({ days: -2, hours: -1 }),
    yesterdayMorning: buildTimestamp({ days: -1, hours: -4 }),
    yesterdayAfternoon: buildTimestamp({ days: -1, hours: 1 }),
    thisMorning: buildTimestamp({ hours: -4 }),
    ninetyMinutesAgo: buildTimestamp({ hours: -1, minutes: -30 }),
    oneHourAgo: buildTimestamp({ hours: -1 }),
    thirtyMinutesAgo: buildTimestamp({ minutes: -30 }),
    inThreeHours: buildTimestamp({ hours: 3 }),
    tomorrowMidday: buildTimestamp({ days: 1, hours: 2 }),
  };

  const companies = [
    {
      id: IDS.companies.apexHoldings,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Apex Timber Operations",
      parent_company_id: null,
      assigned_rep_id: assignees.repPrimary,
      city: "Lake City",
      state: "FL",
      country: "USA",
      address_line_1: "1200 Forestry Way",
      postal_code: "32025",
      metadata: demoMetadata({
        segment: "Forestry contractor",
        branch_count: 2,
      }),
    },
    {
      id: IDS.companies.apexLakeCity,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Apex Timber Operations - Lake City Branch",
      parent_company_id: IDS.companies.apexHoldings,
      assigned_rep_id: assignees.repPrimary,
      city: "Lake City",
      state: "FL",
      country: "USA",
      address_line_1: "1415 County Road 252",
      postal_code: "32024",
      metadata: demoMetadata({
        branch_type: "Service and delivery yard",
      }),
    },
    {
      id: IDS.companies.gulfCoast,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Gulf Coast Land Clearing",
      parent_company_id: null,
      assigned_rep_id: assignees.repSecondary,
      city: "Pensacola",
      state: "FL",
      country: "USA",
      address_line_1: "88 Industrial Loop",
      postal_code: "32505",
      metadata: demoMetadata({
        segment: "Municipal and utility clearing",
      }),
    },
    {
      id: IDS.companies.pineRiver,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Pine River Equipment Rental",
      parent_company_id: null,
      assigned_rep_id: assignees.repSecondary,
      city: "Valdosta",
      state: "GA",
      country: "USA",
      address_line_1: "705 Commerce Park",
      postal_code: "31601",
      metadata: demoMetadata({
        segment: "Rental fleet operator",
      }),
    },
    {
      id: IDS.companies.southernSiteworks,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Southern Siteworks Group",
      parent_company_id: null,
      assigned_rep_id: assignees.repPrimary,
      city: "Gainesville",
      state: "FL",
      country: "USA",
      address_line_1: "4120 Archer Trade Park",
      postal_code: "32608",
      metadata: demoMetadata({
        segment: "Civil site prep and commercial pads",
      }),
    },
    {
      id: IDS.companies.redClayQuarry,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Red Clay Quarry Services",
      parent_company_id: null,
      assigned_rep_id: assignees.repSecondary,
      city: "Macon",
      state: "GA",
      country: "USA",
      address_line_1: "88 Granite Spur",
      postal_code: "31206",
      metadata: demoMetadata({
        segment: "Aggregate and quarry operations",
      }),
    },
    {
      id: IDS.companies.coastalUtilities,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Coastal Utility Contractors",
      parent_company_id: null,
      assigned_rep_id: assignees.repSecondary,
      city: "Savannah",
      state: "GA",
      country: "USA",
      address_line_1: "910 Riverport Industrial",
      postal_code: "31408",
      metadata: demoMetadata({
        segment: "Underground utility and municipal work",
      }),
    },
  ];

  const contacts = [
    {
      id: IDS.contacts.mason,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Mason",
      last_name: "Reed",
      email: "mason.reed@apextimber.demo",
      phone: "(386) 555-0142",
      title: "Operations Director",
      primary_company_id: IDS.companies.apexHoldings,
      assigned_rep_id: assignees.repPrimary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.contacts.hannah,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Hannah",
      last_name: "Brooks",
      email: "hannah.brooks@apextimber.demo",
      phone: "(386) 555-0118",
      title: "Fleet Manager",
      primary_company_id: IDS.companies.apexLakeCity,
      assigned_rep_id: assignees.repPrimary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.contacts.jordan,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Jordan",
      last_name: "Blake",
      email: "jordan.blake@gulfcoast.demo",
      phone: "(850) 555-0131",
      title: "General Superintendent",
      primary_company_id: IDS.companies.gulfCoast,
      assigned_rep_id: assignees.repSecondary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.contacts.jordon,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Jordon",
      last_name: "Blake",
      email: "j.blake@gulfcoast.demo",
      phone: "(850) 555-0131",
      title: "Field Ops Superintendent",
      primary_company_id: IDS.companies.gulfCoast,
      assigned_rep_id: assignees.repSecondary,
      metadata: demoMetadata({ duplicateSeed: true }),
    },
    {
      id: IDS.contacts.elena,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Elena",
      last_name: "Cruz",
      email: "elena.cruz@pineriver.demo",
      phone: "(229) 555-0180",
      title: "Rental Supervisor",
      primary_company_id: IDS.companies.pineRiver,
      assigned_rep_id: assignees.repSecondary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.contacts.wes,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Wes",
      last_name: "Carver",
      email: "wes.carver@apextimber.demo",
      phone: "(386) 555-0156",
      title: "Branch Superintendent",
      primary_company_id: IDS.companies.apexLakeCity,
      assigned_rep_id: assignees.repPrimary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.contacts.dalton,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Dalton",
      last_name: "Price",
      email: "dalton.price@southernsiteworks.demo",
      phone: "(352) 555-0172",
      title: "Estimator",
      primary_company_id: IDS.companies.southernSiteworks,
      assigned_rep_id: assignees.repPrimary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.contacts.tessa,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Tessa",
      last_name: "Morgan",
      email: "tessa.morgan@southernsiteworks.demo",
      phone: "(352) 555-0188",
      title: "Operations Manager",
      primary_company_id: IDS.companies.southernSiteworks,
      assigned_rep_id: assignees.repPrimary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.contacts.luke,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Luke",
      last_name: "Bennett",
      email: "luke.bennett@redclay.demo",
      phone: "(478) 555-0134",
      title: "Quarry Superintendent",
      primary_company_id: IDS.companies.redClayQuarry,
      assigned_rep_id: assignees.repSecondary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.contacts.sara,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Sara",
      last_name: "Keene",
      email: "sara.keene@redclay.demo",
      phone: "(478) 555-0159",
      title: "Controller",
      primary_company_id: IDS.companies.redClayQuarry,
      assigned_rep_id: assignees.repSecondary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.contacts.owen,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Owen",
      last_name: "Harper",
      email: "owen.harper@coastalutility.demo",
      phone: "(912) 555-0106",
      title: "Field Operations Lead",
      primary_company_id: IDS.companies.coastalUtilities,
      assigned_rep_id: assignees.repSecondary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.contacts.nick,
      workspace_id: DEMO_WORKSPACE_ID,
      first_name: "Nick",
      last_name: "Duran",
      email: "nick.duran@coastalutility.demo",
      phone: "(912) 555-0147",
      title: "Fleet Coordinator",
      primary_company_id: IDS.companies.coastalUtilities,
      assigned_rep_id: assignees.repSecondary,
      metadata: demoMetadata(),
    },
  ];

  const contactCompanies = [
    {
      id: IDS.contactCompanies.masonApex,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.mason,
      company_id: IDS.companies.apexHoldings,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.hannahApex,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.hannah,
      company_id: IDS.companies.apexLakeCity,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.jordanGulf,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.jordan,
      company_id: IDS.companies.gulfCoast,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.jordonGulf,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.jordon,
      company_id: IDS.companies.gulfCoast,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.elenaPine,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.elena,
      company_id: IDS.companies.pineRiver,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.wesApex,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.wes,
      company_id: IDS.companies.apexLakeCity,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.daltonSouthern,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.dalton,
      company_id: IDS.companies.southernSiteworks,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.tessaSouthern,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.tessa,
      company_id: IDS.companies.southernSiteworks,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.lukeRedClay,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.luke,
      company_id: IDS.companies.redClayQuarry,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.saraRedClay,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.sara,
      company_id: IDS.companies.redClayQuarry,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.owenCoastal,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.owen,
      company_id: IDS.companies.coastalUtilities,
      is_primary: true,
    },
    {
      id: IDS.contactCompanies.nickCoastal,
      workspace_id: DEMO_WORKSPACE_ID,
      contact_id: IDS.contacts.nick,
      company_id: IDS.companies.coastalUtilities,
      is_primary: true,
    },
  ];

  const equipment = [
    {
      id: IDS.equipment.apexDozer,
      workspace_id: DEMO_WORKSPACE_ID,
      company_id: IDS.companies.apexHoldings,
      primary_contact_id: IDS.contacts.mason,
      name: "Barko 495B Track Loader",
      asset_tag: "APX-495B-01",
      serial_number: "BK495B-FL-001",
      metadata: demoMetadata({ status: "active" }),
    },
    {
      id: IDS.equipment.apexMulcher,
      workspace_id: DEMO_WORKSPACE_ID,
      company_id: IDS.companies.apexLakeCity,
      primary_contact_id: IDS.contacts.hannah,
      name: "Bandit 2460XP Drum Chipper",
      asset_tag: "APX-2460XP-02",
      serial_number: "BD2460-FL-002",
      metadata: demoMetadata({ status: "demo_unit" }),
    },
    {
      id: IDS.equipment.pineSkidSteer,
      workspace_id: DEMO_WORKSPACE_ID,
      company_id: IDS.companies.pineRiver,
      primary_contact_id: IDS.contacts.elena,
      name: "Yanmar TL100VS Compact Track Loader",
      asset_tag: "PRR-TL100-03",
      serial_number: "YNTL100-GA-003",
      metadata: demoMetadata({ status: "rental_ready" }),
    },
    {
      id: IDS.equipment.southernExcavator,
      workspace_id: DEMO_WORKSPACE_ID,
      company_id: IDS.companies.southernSiteworks,
      primary_contact_id: IDS.contacts.tessa,
      name: "Develon DX235LCR Excavator",
      asset_tag: "SSG-DX235-04",
      serial_number: "DX235-FL-004",
      metadata: demoMetadata({ status: "quoted_replacement" }),
    },
    {
      id: IDS.equipment.redClayWheelLoader,
      workspace_id: DEMO_WORKSPACE_ID,
      company_id: IDS.companies.redClayQuarry,
      primary_contact_id: IDS.contacts.luke,
      name: "Kawasaki 67Z7 Wheel Loader",
      asset_tag: "RCQ-67Z7-05",
      serial_number: "KW67Z7-GA-005",
      metadata: demoMetadata({ status: "high_hours" }),
    },
    {
      id: IDS.equipment.coastalMiniEx,
      workspace_id: DEMO_WORKSPACE_ID,
      company_id: IDS.companies.coastalUtilities,
      primary_contact_id: IDS.contacts.owen,
      name: "Yanmar ViO55-6A Mini Excavator",
      asset_tag: "CUT-VIO55-06",
      serial_number: "YMVIO55-GA-006",
      metadata: demoMetadata({ status: "demo_unit" }),
    },
    {
      id: IDS.equipment.coastalVacTrailer,
      workspace_id: DEMO_WORKSPACE_ID,
      company_id: IDS.companies.coastalUtilities,
      primary_contact_id: IDS.contacts.nick,
      name: "Vacuum Excavation Trailer Package",
      asset_tag: "CUT-VAC-07",
      serial_number: "VACPKG-GA-007",
      metadata: demoMetadata({ status: "spec_review" }),
    },
  ];

  const deals = [
    {
      id: IDS.deals.barkoPackage,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Barko 495B loader package",
      stage_id: stages["Negotiation"],
      primary_contact_id: IDS.contacts.mason,
      company_id: IDS.companies.apexHoldings,
      assigned_rep_id: assignees.repPrimary,
      amount: 485000,
      expected_close_on: buildDate(10),
      next_follow_up_at: timestamps.inThreeHours,
      metadata: demoMetadata({ equipment_family: "Barko 495B" }),
    },
    {
      id: IDS.deals.banditDemo,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Bandit chipper field demo",
      stage_id: stages["Demo Scheduled"],
      primary_contact_id: IDS.contacts.hannah,
      company_id: IDS.companies.apexLakeCity,
      assigned_rep_id: assignees.repPrimary,
      amount: 128000,
      expected_close_on: buildDate(18),
      next_follow_up_at: timestamps.tomorrowMidday,
      metadata: demoMetadata({ demo_location: "Lake City branch yard" }),
    },
    {
      id: IDS.deals.prinothRevision,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Prinoth Panther T14 quote revision",
      stage_id: stages["Quote Working"],
      primary_contact_id: IDS.contacts.jordan,
      company_id: IDS.companies.gulfCoast,
      assigned_rep_id: assignees.repSecondary,
      amount: 365000,
      expected_close_on: buildDate(21),
      next_follow_up_at: timestamps.inThreeHours,
      metadata: demoMetadata({ focus: "trade allowance and delivery timing" }),
    },
    {
      id: IDS.deals.yanmarRental,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Yanmar compact fleet refresh",
      stage_id: stages["Discovery"],
      primary_contact_id: IDS.contacts.elena,
      company_id: IDS.companies.pineRiver,
      assigned_rep_id: assignees.repSecondary,
      amount: 92000,
      expected_close_on: buildDate(30),
      next_follow_up_at: timestamps.tomorrowMidday,
      metadata: demoMetadata({ fleet_need: "rental utilization" }),
    },
    {
      id: IDS.deals.asvWon,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "ASV RT-135 storm response package",
      stage_id: stages["Closed Won"],
      primary_contact_id: IDS.contacts.wes,
      company_id: IDS.companies.apexLakeCity,
      assigned_rep_id: assignees.repPrimary,
      amount: 214000,
      expected_close_on: buildDate(-5),
      next_follow_up_at: null,
      closed_at: timestamps.yesterdayMorning,
      metadata: demoMetadata({ win_story: "Won on uptime, operator support, and freight timing" }),
    },
    {
      id: IDS.deals.municipalLost,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Municipal mulcher replacement",
      stage_id: stages["Closed Lost"],
      primary_contact_id: IDS.contacts.jordan,
      company_id: IDS.companies.gulfCoast,
      assigned_rep_id: assignees.repSecondary,
      amount: 248000,
      expected_close_on: buildDate(-3),
      next_follow_up_at: null,
      closed_at: timestamps.yesterdayAfternoon,
      loss_reason: "Budget committee delayed replacement to next fiscal cycle",
      competitor: "Fecon dealer network",
      metadata: demoMetadata({ loss_story: "Lost on budget timing and competitor delivery slot" }),
    },
    {
      id: IDS.deals.develonExcavator,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Develon DX235LCR replacement package",
      stage_id: stages["Quote Working"],
      primary_contact_id: IDS.contacts.tessa,
      company_id: IDS.companies.southernSiteworks,
      assigned_rep_id: assignees.repPrimary,
      amount: 268000,
      expected_close_on: buildDate(16),
      next_follow_up_at: timestamps.tomorrowMidday,
      metadata: demoMetadata({ priority: "earthwork crews need tighter tail-swing unit" }),
    },
    {
      id: IDS.deals.kobelcoFleet,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Kobelco fleet refresh discussion",
      stage_id: stages["Discovery"],
      primary_contact_id: IDS.contacts.dalton,
      company_id: IDS.companies.southernSiteworks,
      assigned_rep_id: assignees.repPrimary,
      amount: 410000,
      expected_close_on: buildDate(28),
      next_follow_up_at: timestamps.inThreeHours,
      metadata: demoMetadata({ focus: "bid pipeline and rent-to-own structure" }),
    },
    {
      id: IDS.deals.utilityMiniEx,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Yanmar mini-ex utility package",
      stage_id: stages["Demo Scheduled"],
      primary_contact_id: IDS.contacts.owen,
      company_id: IDS.companies.coastalUtilities,
      assigned_rep_id: assignees.repSecondary,
      amount: 87000,
      expected_close_on: buildDate(12),
      next_follow_up_at: timestamps.inThreeHours,
      metadata: demoMetadata({ municipality: "Savannah utility trenching crews" }),
    },
    {
      id: IDS.deals.quarryLoaderUpgrade,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Wheel loader upgrade for Red Clay",
      stage_id: stages["Negotiation"],
      primary_contact_id: IDS.contacts.luke,
      company_id: IDS.companies.redClayQuarry,
      assigned_rep_id: assignees.repSecondary,
      amount: 322000,
      expected_close_on: buildDate(8),
      next_follow_up_at: timestamps.oneHourAgo,
      metadata: demoMetadata({ blocker: "finance signoff on residual value" }),
    },
    {
      id: IDS.deals.vacuumTrailerPackage,
      workspace_id: DEMO_WORKSPACE_ID,
      name: "Vac trailer and support package",
      stage_id: stages["Quote Working"],
      primary_contact_id: IDS.contacts.nick,
      company_id: IDS.companies.coastalUtilities,
      assigned_rep_id: assignees.repSecondary,
      amount: 146000,
      expected_close_on: buildDate(14),
      next_follow_up_at: timestamps.tomorrowMidday,
      metadata: demoMetadata({ upsell: "support trailer, hose kit, camera package" }),
    },
  ];

  const activities = [
    {
      id: IDS.activities.barkoCall,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "call",
      body: "Confirmed the loader spec, delivery window, and operator training needs. Customer wants final freight numbers before green light.",
      occurred_at: timestamps.thisMorning,
      deal_id: IDS.deals.barkoPackage,
      created_by: assignees.repPrimary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.activities.barkoTask,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "task",
      body: "Send final freight breakdown and financing option comparison before lunch.",
      occurred_at: timestamps.yesterdayAfternoon,
      deal_id: IDS.deals.barkoPackage,
      created_by: assignees.repPrimary,
      metadata: demoMetadata({ task: { dueAt: timestamps.oneHourAgo, status: "open" } }),
    },
    {
      id: IDS.activities.barkoEmail,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "email",
      body: "Sending the updated loader package with freight, protection plan, and operator onboarding schedule attached.",
      occurred_at: timestamps.yesterdayMorning,
      deal_id: IDS.deals.barkoPackage,
      created_by: assignees.repPrimary,
      metadata: demoMetadata({ delivery: { mode: "live", provider: "sendgrid", status: "sent" } }),
    },
    {
      id: IDS.activities.apexNote,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "note",
      body: "Branch leadership is trying to consolidate loader replacements into one Q2 budget window.",
      occurred_at: timestamps.yesterdayAfternoon,
      company_id: IDS.companies.apexHoldings,
      created_by: assignees.manager,
      metadata: demoMetadata(),
    },
    {
      id: IDS.activities.banditSms,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "sms",
      body: "Crew is ready Thursday morning. Reply with the exact chipper setup you want on site and we’ll stage it before you arrive.",
      occurred_at: timestamps.ninetyMinutesAgo,
      deal_id: IDS.deals.banditDemo,
      created_by: assignees.repPrimary,
      metadata: demoMetadata({ delivery: { mode: "manual", provider: "twilio", status: "logged" } }),
    },
    {
      id: IDS.activities.banditMeeting,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "meeting",
      body: "Field demo locked for Thursday at 10:30 AM. Branch crew wants knife-change walkthrough included.",
      occurred_at: timestamps.thisMorning,
      deal_id: IDS.deals.banditDemo,
      created_by: assignees.repPrimary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.activities.masonEmail,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "email",
      body: "Logged the spec recap and branch pricing notes from the phone conversation. This one was sent outside the system and needs a clean resend if requested.",
      occurred_at: timestamps.twoDaysAgo,
      contact_id: IDS.contacts.mason,
      created_by: assignees.manager,
      metadata: demoMetadata({ delivery: { mode: "manual", provider: "sendgrid", status: "logged" } }),
    },
    {
      id: IDS.activities.prinothTask,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "task",
      body: "Get trade photos and revised freight lane before sending the Panther revision.",
      occurred_at: timestamps.thirtyMinutesAgo,
      deal_id: IDS.deals.prinothRevision,
      created_by: assignees.repSecondary,
      metadata: demoMetadata({ task: { dueAt: timestamps.tomorrowMidday, status: "open" } }),
    },
    {
      id: IDS.activities.pineCall,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "call",
      body: "Rental supervisor wants a loader package that can rotate between land-clearing and compact fleet overflow work.",
      occurred_at: timestamps.thirtyMinutesAgo,
      company_id: IDS.companies.pineRiver,
      created_by: assignees.repSecondary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.activities.gulfTask,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "task",
      body: "Delivered trade allowance summary and competitor notes to the customer.",
      occurred_at: timestamps.yesterdayMorning,
      company_id: IDS.companies.gulfCoast,
      created_by: assignees.repSecondary,
      metadata: demoMetadata({ task: { dueAt: timestamps.yesterdayAfternoon, status: "completed" } }),
    },
    {
      id: IDS.activities.southernSiteVisit,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "meeting",
      body: "Walked the commercial pad job and confirmed the reduced-tail-swing excavator is the best fit around existing utilities.",
      occurred_at: timestamps.ninetyMinutesAgo,
      deal_id: IDS.deals.develonExcavator,
      created_by: assignees.repPrimary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.activities.southernQuoteTask,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "task",
      body: "Send revised quote with maintenance package and two bucket options before the estimator review.",
      occurred_at: timestamps.thirtyMinutesAgo,
      deal_id: IDS.deals.develonExcavator,
      created_by: assignees.repPrimary,
      metadata: demoMetadata({ task: { dueAt: timestamps.inThreeHours, status: "open" } }),
    },
    {
      id: IDS.activities.quarryFinanceCall,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "call",
      body: "Finance team wants a cleaner residual assumption and extended warranty option before they approve the loader swap.",
      occurred_at: timestamps.thisMorning,
      deal_id: IDS.deals.quarryLoaderUpgrade,
      created_by: assignees.repSecondary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.activities.quarryEmail,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "email",
      body: "Shared quarry loader upgrade numbers, monthly payment ranges, and trade assumptions with the controller.",
      occurred_at: timestamps.oneHourAgo,
      contact_id: IDS.contacts.sara,
      created_by: assignees.repSecondary,
      metadata: demoMetadata({ delivery: { mode: "manual", provider: "sendgrid", status: "logged" } }),
    },
    {
      id: IDS.activities.coastalInspection,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "note",
      body: "Crew is replacing a leaking mini-ex unit and wants tighter transport weight for city street work.",
      occurred_at: timestamps.thisMorning,
      company_id: IDS.companies.coastalUtilities,
      created_by: assignees.repSecondary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.activities.coastalTask,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "task",
      body: "Confirm demo trailer delivery time and send trench box compatibility notes.",
      occurred_at: timestamps.ninetyMinutesAgo,
      deal_id: IDS.deals.utilityMiniEx,
      created_by: assignees.repSecondary,
      metadata: demoMetadata({ task: { dueAt: timestamps.tomorrowMidday, status: "open" } }),
    },
    {
      id: IDS.activities.utilityMiniDemo,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "meeting",
      body: "Mini excavator demo tentatively scheduled for first thing tomorrow with the utility foreman and fleet coordinator.",
      occurred_at: timestamps.thirtyMinutesAgo,
      deal_id: IDS.deals.utilityMiniEx,
      created_by: assignees.repSecondary,
      metadata: demoMetadata(),
    },
    {
      id: IDS.activities.utilitySms,
      workspace_id: DEMO_WORKSPACE_ID,
      activity_type: "sms",
      body: "We can have the demo unit on your yard at 7:30 AM. Reply if you want the breaker attachment included.",
      occurred_at: timestamps.oneHourAgo,
      contact_id: IDS.contacts.owen,
      created_by: assignees.repSecondary,
      metadata: demoMetadata({ delivery: { mode: "manual", provider: "twilio", status: "logged" } }),
    },
  ];

  const { error: companyError } = await admin.from("crm_companies").upsert(companies, { onConflict: "id" });
  if (companyError) throw companyError;

  const { error: contactError } = await admin.from("crm_contacts").upsert(contacts, { onConflict: "id" });
  if (contactError) throw contactError;

  const { error: contactCompanyError } = await admin.from("crm_contact_companies").upsert(contactCompanies, {
    onConflict: "workspace_id,contact_id,company_id",
  });
  if (contactCompanyError) throw contactCompanyError;

  const { error: equipmentError } = await admin.from("crm_equipment").upsert(equipment, { onConflict: "id" });
  if (equipmentError) throw equipmentError;

  const { error: dealError } = await admin.from("crm_deals").upsert(deals, { onConflict: "id" });
  if (dealError) throw dealError;

  const { error: activityError } = await admin.from("crm_activities").upsert(activities, { onConflict: "id" });
  if (activityError) throw activityError;

  return {
    companies: companies.length,
    contacts: contacts.length,
    equipment: equipment.length,
    deals: deals.length,
    activities: activities.length,
  };
}

Deno.serve(async (req) => {
  const ch = corsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, ch);
  }

  if (!DEMO_ADMIN_SECRET) {
    return jsonResponse({ error: "DEMO_ADMIN_SECRET is not configured." }, 500, ch);
  }

  const providedSecret = req.headers.get("x-demo-admin-secret");
  if (!providedSecret || providedSecret !== DEMO_ADMIN_SECRET) {
    return jsonResponse({ error: "Unauthorized" }, 401, ch);
  }

  try {
    const body = await req.json() as RequestBody;
    const action = body.action ?? "seed";

    if (action !== "seed" && action !== "reset") {
      return jsonResponse({ error: "Unsupported action" }, 400, ch);
    }

    const voiceSummary = await purgeVoiceCaptures();
    await resetDemoData();

    if (action === "reset") {
      return jsonResponse(
        {
          ok: true,
          action,
          batchId: DEMO_BATCH_ID,
          voiceSummary,
          demoSummary: {
            companies: 0,
            contacts: 0,
            equipment: 0,
            deals: 0,
            activities: 0,
          },
          servicePartsSummary: {
            partsInventory: 0,
            serviceJobs: 0,
            requirements: 0,
          },
        },
        200,
        ch,
      );
    }

    const demoSummary = await seedDemoData();
    const assignees = await resolveAssignees();
    const servicePartsSummary = await seedServicePartsDemoData(admin, {
      companies: {
        apexHoldings: IDS.companies.apexHoldings,
        apexLakeCity: IDS.companies.apexLakeCity,
        gulfCoast: IDS.companies.gulfCoast,
        pineRiver: IDS.companies.pineRiver,
      },
      contacts: {
        mason: IDS.contacts.mason,
        hannah: IDS.contacts.hannah,
        jordan: IDS.contacts.jordan,
        elena: IDS.contacts.elena,
      },
      equipment: {
        apexDozer: IDS.equipment.apexDozer,
        apexMulcher: IDS.equipment.apexMulcher,
        pineSkidSteer: IDS.equipment.pineSkidSteer,
      },
    }, assignees);
    return jsonResponse({
      ok: true,
      action,
      batchId: DEMO_BATCH_ID,
      voiceSummary,
      demoSummary,
      servicePartsSummary,
    }, 200, ch);
  } catch (error) {
    console.error("[demo-admin] failed:", error);
    return jsonResponse(
      { error: describeError(error) },
      500,
      ch,
    );
  }
});
