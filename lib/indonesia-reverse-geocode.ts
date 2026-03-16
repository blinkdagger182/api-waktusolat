const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_APP_ID = "api-waktusolat/1.0";
const DEFAULT_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

type ReverseAddress = {
  country?: string;
  state?: string;
  city?: string;
  town?: string;
  municipality?: string;
  county?: string;
  state_district?: string;
  city_district?: string;
  suburb?: string;
  village?: string;
};

export type IndonesiaReverseGeocodeResult = {
  display_name: string | null;
  country: string | null;
  province: string | null;
  city: string | null;
  regency: string | null;
  locality: string | null;
  subAdministrativeArea: string | null;
  raw: ReverseAddress;
};

type CacheEntry = {
  expiresAt: number;
  value: IndonesiaReverseGeocodeResult;
};

const reverseGeocodeCache = new Map<string, CacheEntry>();

function createCacheKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

function pickFirstNonEmpty(values: Array<string | undefined>) {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

export async function reverseGeocodeIndonesia(latitude: number, longitude: number) {
  const cacheKey = createCacheKey(latitude, longitude);
  const now = Date.now();
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const url = new URL(NOMINATIM_BASE_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "id,en");
  url.searchParams.set("lat", latitude.toString());
  url.searchParams.set("lon", longitude.toString());

  const email = process.env.NOMINATIM_EMAIL;
  if (email) {
    url.searchParams.set("email", email);
  }

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": process.env.NOMINATIM_USER_AGENT ?? NOMINATIM_APP_ID,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Reverse geocoding failed (${response.status})`);
  }

  const payload = await response.json();
  const address = (payload.address ?? {}) as ReverseAddress;
  const result = {
    display_name: payload.display_name ?? null,
    country: address.country ?? null,
    province: pickFirstNonEmpty([address.state]),
    city: pickFirstNonEmpty([address.city, address.town, address.municipality]),
    regency: pickFirstNonEmpty([address.county, address.state_district]),
    locality: pickFirstNonEmpty([address.city_district, address.suburb, address.village]),
    subAdministrativeArea: pickFirstNonEmpty([address.county, address.state_district]),
    raw: address,
  };

  reverseGeocodeCache.set(cacheKey, {
    expiresAt: now + DEFAULT_CACHE_TTL_MS,
    value: result,
  });

  return result;
}
