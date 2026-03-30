import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

interface DealStageRow {
  id: string;
  name: string;
  is_closed_won: boolean;
  is_closed_lost: boolean;
}

export interface DealStageResolution {
  stageId: string;
  stageName: string;
  isClosedWon: boolean;
  isClosedLost: boolean;
  usedFallback: boolean;
  fallbackReason: string | null;
}

export async function resolveDealStage(
  supabase: SupabaseClient,
  workspaceId: string,
  hubspotStageId: string | null,
  mode: "webhook" | "import",
): Promise<DealStageResolution> {
  if (hubspotStageId) {
    const { data, error } = await supabase
      .from("crm_deal_stages")
      .select("id, name, is_closed_won, is_closed_lost")
      .eq("workspace_id", workspaceId)
      .eq("hubspot_stage_id", hubspotStageId)
      .maybeSingle<DealStageRow>();

    if (error) {
      throw new Error(`Failed to query crm_deal_stages: ${error.message}`);
    }

    if (data) {
      return {
        stageId: data.id,
        stageName: data.name,
        isClosedWon: data.is_closed_won,
        isClosedLost: data.is_closed_lost,
        usedFallback: false,
        fallbackReason: null,
      };
    }

    if (mode === "webhook") {
      const stageId = crypto.randomUUID();
      const stageName = `HubSpot Stage ${hubspotStageId}`;
      const { error: insertError } = await supabase
        .from("crm_deal_stages")
        .insert({
          id: stageId,
          workspace_id: workspaceId,
          name: stageName,
          hubspot_stage_id: hubspotStageId,
          sort_order: 9_999,
        });

      if (insertError) {
        throw new Error(
          `Failed to insert crm_deal_stages row: ${insertError.message}`,
        );
      }

      return {
        stageId,
        stageName,
        isClosedWon: false,
        isClosedLost: false,
        usedFallback: false,
        fallbackReason: null,
      };
    }
  }

  const { data: defaultStage, error: defaultStageError } = await supabase
    .from("crm_deal_stages")
    .select("id, name, is_closed_won, is_closed_lost")
    .eq("workspace_id", workspaceId)
    .eq("is_closed_won", false)
    .eq("is_closed_lost", false)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle<DealStageRow>();

  if (defaultStageError) {
    throw new Error(
      `Failed to query default stage: ${defaultStageError.message}`,
    );
  }

  if (defaultStage) {
    return {
      stageId: defaultStage.id,
      stageName: defaultStage.name,
      isClosedWon: defaultStage.is_closed_won,
      isClosedLost: defaultStage.is_closed_lost,
      usedFallback: true,
      fallbackReason: hubspotStageId
        ? "unknown_hubspot_stage"
        : "missing_hubspot_stage",
    };
  }

  const stageId = crypto.randomUUID();
  const stageName = "Imported - Default Open";
  const { error: createError } = await supabase
    .from("crm_deal_stages")
    .insert({
      id: stageId,
      workspace_id: workspaceId,
      name: stageName,
      sort_order: 9_999,
      is_closed_won: false,
      is_closed_lost: false,
      metadata: {
        is_default_import_stage: true,
        source: "hubspot_import_auto",
      },
    });

  if (createError) {
    throw new Error(`Failed to create fallback stage: ${createError.message}`);
  }

  return {
    stageId,
    stageName,
    isClosedWon: false,
    isClosedLost: false,
    usedFallback: true,
    fallbackReason: hubspotStageId
      ? "unknown_hubspot_stage"
      : "missing_hubspot_stage",
  };
}
