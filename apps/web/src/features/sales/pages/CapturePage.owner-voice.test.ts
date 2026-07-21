import { describe, expect, test } from "bun:test";

describe("SA10 sales voice consolidation", () => {
  test("routes the capture hero through Iron and removes duplicate voice destinations", async () => {
    const source = await Bun.file(`${import.meta.dir}/CapturePage.tsx`).text();

    expect(source).toContain("const { openBar: openIron } = useIronStore()");
    expect(source).toContain("onClick={openIron}");
    expect(source).toContain("IRON classifies, confirms, then takes action");
    expect(source).not.toContain("SmartVoiceCapture");
    expect(source).not.toContain('href: "/sales/voice-quote"');
    expect(source).not.toContain('href: "/sales/field-note"');
  });

  test("routes the Today voice action through the same Iron surface", async () => {
    const source = await Bun.file(`${import.meta.dir}/TodayFeedPage.tsx`).text();

    expect(source).toContain("const { openBar } = useIronStore()");
    expect(source).toContain("const handleVoiceDictate = () => openBar()");
  });

  test("places open deals and follow-ups immediately after the AI briefing", async () => {
    const source = await Bun.file(`${import.meta.dir}/TodayFeedPage.tsx`).text();
    const briefingIndex = source.indexOf("<EveningBriefingHero");
    const prioritiesIndex = source.indexOf("<SalesActionsBlock");
    const narrativeIndex = source.indexOf("<SalesNarrativeBlock");

    expect(briefingIndex).toBeGreaterThan(-1);
    expect(prioritiesIndex).toBeGreaterThan(briefingIndex);
    expect(narrativeIndex).toBeGreaterThan(prioritiesIndex);
  });
});
