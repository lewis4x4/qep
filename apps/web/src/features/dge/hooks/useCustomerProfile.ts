import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCustomerProfile } from "../lib/dge-api";
import type { CustomerProfileResponse } from "../types";

interface CustomerProfileQuery {
  email?: string;
  hubspotContactId?: string;
  intellidealerCustomerId?: string;
  includeFleet?: boolean;
}

interface UseCustomerProfileResult {
  data: CustomerProfileResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCustomerProfile(
  query: CustomerProfileQuery,
  enabled: boolean,
): UseCustomerProfileResult {
  const [data, setData] = useState<CustomerProfileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  const run = useCallback(async () => {
    if (!enabled) {
      setData(null);
      setError(null);
      return;
    }

    const hasLookup = Boolean(
      query.email || query.hubspotContactId || query.intellidealerCustomerId,
    );
    if (!hasLookup) {
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetchCustomerProfile(query);
      setData(response);
    } catch (nextError) {
      setData(null);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [enabled, query]);

  useEffect(() => {
    void run();
  }, [queryKey, run]);

  return {
    data,
    loading,
    error,
    refresh: run,
  };
}
