import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMarketValuation } from "../lib/dge-api";
import type {
  MarketValuationRequest,
  MarketValuationResult,
} from "../types";

interface UseMarketValuationResult {
  data: MarketValuationResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMarketValuation(
  request: MarketValuationRequest | null,
  enabled: boolean,
): UseMarketValuationResult {
  const [data, setData] = useState<MarketValuationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestKey = useMemo(
    () => (request ? JSON.stringify(request) : "no-request"),
    [request],
  );

  const run = useCallback(async () => {
    if (!enabled || !request) {
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetchMarketValuation(request);
      setData(response);
    } catch (nextError) {
      setData(null);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [enabled, request]);

  useEffect(() => {
    void run();
  }, [requestKey, run]);

  return {
    data,
    loading,
    error,
    refresh: run,
  };
}
