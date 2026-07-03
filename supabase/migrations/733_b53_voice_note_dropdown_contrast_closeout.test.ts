import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const readText = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
const compact = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

const closeoutSql = readText("supabase", "migrations", "733_b53_voice_note_dropdown_contrast_closeout.sql");
const picker = readText("apps", "web", "src", "features", "sales", "components", "CustomerPickerInline.tsx");
const smartVoiceCapture = readText(
  "apps",
  "web",
  "src",
  "features",
  "sales",
  "components",
  "SmartVoiceCapture.tsx",
);
const pickerTest = readText(
  "apps",
  "web",
  "src",
  "features",
  "sales",
  "components",
  "SmartVoiceCapture.customer-picker.test.tsx",
);

const compactCloseout = compact(closeoutSql);
const compactPicker = compact(picker);
const compactSmartVoiceCapture = compact(smartVoiceCapture);
const compactPickerTest = compact(pickerTest);

describe("733_b53_voice_note_dropdown_contrast_closeout.sql contract", () => {
  it("marks only B5.3 shipped with explicit mission evidence", () => {
    expect(compactCloseout).toContain("where task_id = 'b5.3'");
    expect(compactCloseout).toContain("set ship_state = 'shipped'");
    expect(compactCloseout).toContain("blocking_decision = null");
    expect(compactCloseout).toContain("mission_alignment");
    expect(compactCloseout).toContain("field reps using voice capture");
    expect(compactCloseout).toContain("customer attach options");
    expect(compactCloseout).not.toContain("where task_id = 'b5.2'");
    expect(compactCloseout).not.toContain("where task_id = 'b5.4'");
  });

  it("keeps retired-source and manual boundaries explicit", () => {
    expect(compactCloseout).toContain("voicenotecapture.tsx doc path");
    expect(compactCloseout).toContain("documentation-only");
    expect(compactCloseout).toContain("does not alter customer picker runtime behavior");
    expect(compactCloseout).toContain("no live mobile-device uat");
    expect(compactCloseout).toContain("pre-existing migration 212 pg_cron");
  });

  it("anchors the active SmartVoiceCapture picker path", () => {
    expect(compactSmartVoiceCapture).toContain("import { customerpickerinline } from \"./customerpickerinline\"");
    expect(compactSmartVoiceCapture).toContain("<customerpickerinline");
    expect(compactSmartVoiceCapture).toContain("searchcompanies={searchcompaniesforpicker}");
    expect(compactSmartVoiceCapture).toContain("setshowcustomerpicker(false)");
  });

  it("keeps the picker input on design-token contrast classes", () => {
    expect(compactPicker).toContain("border border-input bg-background");
    expect(compactPicker).toContain("text-sm text-foreground");
    expect(compactPicker).toContain("placeholder:text-muted-foreground");
    expect(compactPicker).toContain("focus:border-ring");
    expect(compactPicker).toContain("focus-visible:ring-2");
    expect(compactPicker).toContain("focus-visible:ring-ring/40");
    expect(compactPicker).not.toContain("bg-white");
    expect(compactPicker).not.toContain("text-white");
  });

  it("keeps picker option hover and focus states token-based", () => {
    expect(compactPicker).toContain("text-left text-sm font-medium text-foreground");
    expect(compactPicker).toContain("hover:bg-accent");
    expect(compactPicker).toContain("hover:text-accent-foreground");
    expect(compactPicker).toContain("focus-visible:bg-accent");
    expect(compactPicker).toContain("focus-visible:text-accent-foreground");
    expect(compactPicker).toContain("bg-muted");
    expect(compactPicker).toContain("text-muted-foreground");
  });

  it("locks the contrast contract in the focused picker test", () => {
    expect(compactPickerTest).toContain("uses token-based contrast classes for input and option states");
    expect(compactPickerTest).toContain("expect(input.classname).tocontain(\"border-input\")");
    expect(compactPickerTest).toContain("expect(input.classname).tocontain(\"text-foreground\")");
    expect(compactPickerTest).toContain("expect(input.classname).tocontain(\"placeholder:text-muted-foreground\")");
    expect(compactPickerTest).toContain("expect(input.classname).tocontain(\"focus-visible:ring-2\")");
    expect(compactPickerTest).toContain("expect(input.classname).tocontain(\"focus-visible:ring-ring/40\")");
    expect(compactPickerTest).toContain("expect(optionbutton.classname).tocontain(\"hover:bg-accent\")");
    expect(compactPickerTest).toContain("expect(optionbutton.classname).tocontain(\"hover:text-accent-foreground\")");
    expect(compactPickerTest).toContain("expect(optionbutton.classname).tocontain(\"focus-visible:bg-accent\")");
    expect(compactPickerTest).toContain("expect(optionbutton.classname).tocontain(\"focus-visible:text-accent-foreground\")");
  });
});
