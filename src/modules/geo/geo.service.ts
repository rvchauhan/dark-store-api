import { AppError } from "../../shared/errors/app-error.js";

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
  addresstype?: string;
  name?: string;
};
type GeoResult = { lat: number; lng: number; displayName: string; precision: "exact" | "approximate" };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pulls locality tokens (e.g. "Sector 119") out of free-form street lines. */
function extractLocalityHints(street: string): string[] {
  const hints: string[] = [];
  const sector = street.match(/\bsector[\s\-]*(\d+[A-Za-z]?)\b/i);
  if (sector) hints.push(`Sector ${sector[1].toUpperCase()}`);

  // Colony / society / phase style tokens that often geocode better than full lines.
  const named = street.match(
    /\b([A-Za-z][A-Za-z\s]{1,40}?)\s+(colony|enclave|society|apartment|apartments|phase|nagar|vihar|residency|residents)\b/i,
  );
  if (named) hints.push(`${named[1].trim()} ${named[2]}`);

  return [...new Set(hints.map((h) => h.trim()).filter(Boolean))];
}

function resultMentions(result: NominatimResult, needle: string): boolean {
  const hay = `${result.display_name} ${result.name ?? ""}`.toLowerCase();
  const n = needle.toLowerCase();
  if (hay.includes(n)) return true;
  // "Sector 119" ↔ "sector-119"
  const compact = n.replace(/[\s\-]+/g, "");
  return hay.replace(/[\s\-]+/g, "").includes(compact);
}

/**
 * Geo module service — forward geocoding (address → coordinates) via
 * OpenStreetMap's free Nominatim API. No API key required.
 *
 * Kept server-side rather than called from the browser: Nominatim's usage
 * policy (https://operations.osmfoundation.org/policies/nominatim/) asks for
 * a descriptive User-Agent identifying the calling application, which only a
 * server can reliably guarantee.
 */
export class GeoService {
  /**
   * Hyper-local addresses (house number + small colony/locality name) often
   * aren't indexed verbatim in OSM, even though the city/postal code is.
   * Try from most specific to least, and accept the first hit — the wizard
   * marks anything less than a full street match as "approximate" so the
   * admin knows to fine-tune the pin.
   */
  async lookupAddress(input: {
    street?: string;
    city?: string;
    postalCode?: string;
    country?: string;
  }): Promise<GeoResult> {
    const street = input.street?.trim() || undefined;
    const city = input.city?.trim() || undefined;
    const postalCode = input.postalCode?.trim() || undefined;
    const country = input.country?.trim() || undefined;

    if (!street && !city && !postalCode && !country) {
      throw new AppError(400, "At least one of street, city, postalCode, or country is required", "VALIDATION_ERROR");
    }

    const attempts: {
      params: Record<string, string>;
      precision: "exact" | "approximate";
      requireHint?: string;
    }[] = [];
    const countryParam: Record<string, string> = country ? { country } : {};
    const freeform = [street, city, postalCode, country].filter(Boolean).join(", ");
    const localityHints = street ? extractLocalityHints(street) : [];

    if (street && (city || postalCode)) {
      attempts.push({ params: { q: freeform }, precision: "exact" });
      attempts.push({
        params: {
          street,
          ...(city ? { city } : {}),
          ...(postalCode ? { postalcode: postalCode } : {}),
          ...countryParam,
        },
        precision: "exact",
      });
    }

    // Locality / sector / colony before bare city — much closer for Indian dark-store addresses.
    for (const hint of localityHints) {
      if (city) {
        attempts.push({
          params: { q: `${hint}, ${city}${country ? `, ${country}` : ""}` },
          precision: "approximate",
          requireHint: hint,
        });
      }
      if (postalCode) {
        attempts.push({
          params: { q: `${hint}, ${postalCode}${country ? `, ${country}` : ""}` },
          precision: "approximate",
          requireHint: hint,
        });
      }
    }

    if (city && postalCode) {
      attempts.push({ params: { city, postalcode: postalCode, ...countryParam }, precision: "approximate" });
      attempts.push({
        params: { q: `${city}, ${postalCode}${country ? `, ${country}` : ""}` },
        precision: "approximate",
      });
    }
    // A bare postal code isn't globally unique (verified — "110031" alone matched a
    // street in Shenyang, China) so it's only searched alone when a country scopes it.
    if (postalCode && country && !city) {
      attempts.push({ params: { postalcode: postalCode, country }, precision: "approximate" });
    }
    if (city) {
      attempts.push({ params: { city, ...countryParam }, precision: "approximate" });
    }
    if (!city && country) {
      attempts.push({ params: { country }, precision: "approximate" });
    }

    for (let i = 0; i < attempts.length; i++) {
      if (i > 0) await sleep(300); // stay well under Nominatim's 1 req/sec policy across our own fallback chain
      const attempt = attempts[i];
      const result = await this.query(attempt.params, attempt.requireHint);
      if (result) return { ...result, precision: attempt.precision };
    }

    throw new AppError(404, "No location found for that address", "NOT_FOUND");
  }

  private async query(
    params: Record<string, string>,
    requireHint?: string,
  ): Promise<{ lat: number; lng: number; displayName: string } | null> {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", requireHint ? "5" : "1");

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": "dark-store-portal/1.0 (internal admin tool; store onboarding geocoding)",
        },
      });
    } catch {
      throw new AppError(502, "Unable to reach the geocoding service", "GEOCODE_UNREACHABLE");
    }

    if (!response.ok) {
      throw new AppError(502, "Geocoding lookup failed", "GEOCODE_UNAVAILABLE");
    }

    const results = (await response.json()) as NominatimResult[];
    if (!results.length) return null;

    const picked = requireHint
      ? results
          .filter((r) => resultMentions(r, requireHint))
          .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))[0]
      : results[0];

    if (!picked) return null;

    return { lat: Number(picked.lat), lng: Number(picked.lon), displayName: picked.display_name };
  }
}

export const geoService = new GeoService();
