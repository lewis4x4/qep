/** Provider-key dispatch for telematics payload normalization. */

import { genericTelematicsAdapter } from "./adapters/generic-telematics.ts";
import { yanmarSmartAssistAdapter } from "./adapters/yanmar-smart-assist.ts";
import {
  type NormalizedTelematicsReading,
  type NormalizedTelematicsSignal,
  normalizeOptionalString,
  normalizeProviderKey,
  type TelematicsAdapter,
  type TelematicsAdapterConfig,
} from "./telematics-adapter.ts";

const ADAPTERS: Record<
  string,
  TelematicsAdapter<Record<string, unknown>, Record<string, unknown>>
> = {
  generic_oem: genericTelematicsAdapter,
  aemp: genericTelematicsAdapter,
  yanmar: yanmarSmartAssistAdapter,
  asv: yanmarSmartAssistAdapter,
  ycena: yanmarSmartAssistAdapter,
  smart_assist: yanmarSmartAssistAdapter,
  yanmar_smart_assist: yanmarSmartAssistAdapter,
  ycena_smart_assist: yanmarSmartAssistAdapter,
};

function payloadProvider(
  payload: Record<string, unknown>,
  config?: TelematicsAdapterConfig,
): string {
  return normalizeProviderKey(
    normalizeOptionalString(payload.provider) ??
      normalizeOptionalString(payload.provider_key) ??
      normalizeOptionalString(payload.source) ??
      config?.provider,
    genericTelematicsAdapter.provider,
  );
}

export function resolveTelematicsAdapter(
  payload: Record<string, unknown>,
  config?: TelematicsAdapterConfig,
): TelematicsAdapter<Record<string, unknown>, Record<string, unknown>> {
  const provider = payloadProvider(payload, config);
  return ADAPTERS[provider] ?? genericTelematicsAdapter;
}

export function normalizeTelematicsReading(
  payload: Record<string, unknown>,
  config?: TelematicsAdapterConfig,
): NormalizedTelematicsReading {
  return resolveTelematicsAdapter(payload, config).normalizeReading(
    payload,
    config,
  );
}

export function normalizeTelematicsSignal(
  payload: Record<string, unknown>,
  config?: TelematicsAdapterConfig,
): NormalizedTelematicsSignal {
  const adapter = resolveTelematicsAdapter(payload, config);
  if (!adapter.normalizeSignal) {
    return genericTelematicsAdapter.normalizeSignal(payload, config);
  }
  return adapter.normalizeSignal(payload, config);
}
