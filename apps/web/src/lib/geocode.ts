interface GeoResult {
  lat: number;
  lon: number;
  display_name: string;
}

/**
 * Geocode an address using the Nominatim (OpenStreetMap) API.
 * Free, no API key required. Rate limited to 1 req/sec — callers
 * should debounce. Returns null if no match found.
 */
export async function geocodeAddress(parts: {
  address_line1?: string;
  city?: string;
  state_province?: string;
  postal_code?: string;
  country?: string;
}): Promise<GeoResult | null> {
  const q = [
    parts.address_line1,
    parts.city,
    parts.state_province,
    parts.postal_code,
    parts.country,
  ]
    .filter(Boolean)
    .join(", ");

  if (q.length < 5) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "QEP-OS/1.0 (branch-management)" },
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    display_name: data[0].display_name ?? "",
  };
}
