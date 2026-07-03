import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "719_b21_known_company_voice_capture_closeout.sql");
const voiceQrmPage = readText("apps", "web", "src", "features", "voice-qrm", "pages", "VoiceQrmPage.tsx");
const voiceQrmApi = readText("apps", "web", "src", "features", "voice-qrm", "lib", "voice-qrm-api.ts");
const voiceQrmApiTest = readText("apps", "web", "src", "features", "voice-qrm", "lib", "__tests__", "voice-qrm-api.test.ts");
const accountDetailMenu = readText("apps", "web", "src", "features", "qrm", "lib", "account-detail-menu.ts");
const companyDetailPage = readText("apps", "web", "src", "features", "qrm", "pages", "QrmCompanyDetailPage.tsx");
const edgeIndex = readText("supabase", "functions", "voice-to-qrm", "index.ts");
const companyResolution = readText("supabase", "functions", "voice-to-qrm", "company-resolution.ts");
const companyResolutionTest = readText("supabase", "functions", "voice-to-qrm", "company-resolution.test.ts");
const vc1Helper = readText("supabase", "functions", "voice-to-qrm", "vc1-company-linking.ts");
const vc1HelperTest = readText("supabase", "functions", "voice-to-qrm", "vc1-company-linking.test.ts");

const compactCloseout = compact(closeoutSql);
const compactPage = compact(voiceQrmPage);
const compactApi = compact(voiceQrmApi);
const compactApiTest = compact(voiceQrmApiTest);
const compactAccountMenu = compact(accountDetailMenu);
const compactCompanyPage = compact(companyDetailPage);
const compactEdgeIndex = compact(edgeIndex);
const compactCompanyResolution = compact(companyResolution);
const compactCompanyResolutionTest = compact(companyResolutionTest);
const compactVc1Helper = compact(vc1Helper);
const compactVc1HelperTest = compact(vc1HelperTest);

describe("719_b21_known_company_voice_capture_closeout.sql contract", () => {
  it("marks only B2.1 shipped and keeps neighboring voice rows untouched", () => {
    expect(compactCloseout).toContain("where task_id = 'b2.1'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).not.toContain("where task_id = 'b2.2'");
    expect(compactCloseout).not.toContain("where task_id = 'b2.3'");
    expect(compactCloseout).not.toContain("where task_id = 'b2.4'");
    expect(compactCloseout).not.toContain("where task_id = 'b2.5'");
  });

  it("records mission evidence and honest manual/provider boundaries", () => {
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("known-company voice capture closeout");
    expect(compactCloseout).toContain("disabling fuzzy matching and auto-create");
    expect(compactCloseout).toContain("no omi wearable bridge");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("launches VoiceQRM from known customer/account surfaces with linked_company_id", () => {
    expect(compactAccountMenu).toContain("record voice note");
    expect(compactAccountMenu).toContain("/voice-qrm?linked_company_id=");
    expect(compactCompanyPage).toContain("/voice-qrm?linked_company_id=");
  });

  it("passes linked_company_id from the route into the multipart VoiceQRM request", () => {
    expect(compactPage).toContain('searchparams.get("linked_company_id")');
    expect(compactPage).toContain("linkedcompanyid");
    expect(compactPage).toContain("submitvoicetoqrm({ audioblob: args.audioblob, filename: args.filename, dealid, linkedcompanyid })");
    expect(compactApi).toContain("linkedcompanyid?: string");
    expect(compactApi).toContain('form.append("linked_company_id", opts.linkedcompanyid)');
    expect(compactApiTest).toContain("includes linked_company_id when launched from known customer record");
    expect(compactApiTest).toContain('expect(form.get("linked_company_id")).tobe("company-123")');
  });

  it("verifies caller access before forcing the known company attach", () => {
    expect(compactEdgeIndex).toContain('formdata.get("linked_company_id")');
    expect(compactEdgeIndex).toContain("assertcallercanaccesslinkedcompany( supabase, linkedcompanyidparam");
    expect(compactVc1Helper).toContain('from(table: "crm_companies")');
    expect(compactVc1Helper).toContain(".select(\"id\")");
    expect(compactVc1Helper).toContain(".eq(\"id\", linkedcompanyid)");
    expect(compactVc1Helper).toContain("forbidden_linked_company");
    expect(compactVc1HelperTest).toContain("assertcallercanaccesslinkedcompany allows known accessible company");
    expect(compactVc1HelperTest).toContain("assertcallercanaccesslinkedcompany rejects inaccessible company");
  });

  it("skips fuzzy match and create when a known company was authorized", () => {
    expect(compactCompanyResolution).toContain("authorizedlinkedcompanyid");
    expect(compactCompanyResolution).toContain("forcecompanyid: input.authorizedlinkedcompanyid");
    expect(compactCompanyResolution).toContain("shouldfuzzymatch: false");
    expect(compactCompanyResolution).toContain("shouldcreatecompany: false");
    expect(compactCompanyResolutionTest).toContain("linked company id forces deterministic attach and disables fuzzy/create");
    expect(compactEdgeIndex).toContain("if (companydecision.forcecompanyid)");
    expect(compactEdgeIndex).toContain("companyid = companydecision.forcecompanyid");
    expect(compactEdgeIndex).toContain("} else if (companydecision.shouldfuzzymatch && extracted.company?.name)");
  });

  it("persists the known company links on the capture and timeline activity", () => {
    expect(compactVc1Helper).toContain("linked_company_id: input.companyid");
    expect(compactVc1Helper).toContain("linked_deal_id: input.dealid");
    expect(compactVc1Helper).toContain("linked_contact_id: input.contactid");
    expect(compactVc1Helper).toContain("company_id: input.companyid");
    expect(compactVc1Helper).toContain("deal_id: input.companyid ? null : input.dealid");
    expect(compactVc1HelperTest).toContain("buildvoicecaptureinsertpayload persists linked_company_id and related links");
    expect(compactVc1HelperTest).toContain("insertknowncompanyordealactivity inserts company_id and null deal_id for known-company notes");
  });
});
