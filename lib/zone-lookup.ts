import PolygonLookup from "polygon-lookup";

type ZoneFeatureProperties = {
  jakim_code?: string;
  state?: string;
  name?: string;
};

type ZoneMatch = {
  zone: string;
  state?: string;
  district?: string;
};

type SpecialZoneRule = ZoneMatch & {
  radiusKm: number;
  points: Array<{ latitude: number; longitude: number }>;
};

const PERAK_DISTRICT_ZONE_MAP: Record<string, string> = {
  "batang padang": "PRK01",
  "muallim": "PRK01",
  "kampar": "PRK02",
  "kinta": "PRK02",
  "kuala kangsar": "PRK02",
  "pengkalan hulu": "PRK03",
  "lenggong": "PRK03",
  "gerik": "PRK03",
  "temengor": "PRK04",
  "belum": "PRK04",
  "bagan datuk": "PRK05",
  "hilir perak": "PRK05",
  "manjung": "PRK05",
  "perak tengah": "PRK05",
  "kerian": "PRK06",
  "larut dan matang": "PRK06",
  "selama": "PRK06",
};

// These zones are not represented in the public district geojson, so GPS
// matching needs explicit geofences before the generic polygon lookup runs.
const SPECIAL_ZONE_RULES: SpecialZoneRule[] = [
  {
    zone: "KDH07",
    state: "KDH",
    district: "Puncak Gunung Jerai",
    radiusKm: 6,
    points: [{ latitude: 5.787128, longitude: 100.4347358 }],
  },
  {
    zone: "PRK07",
    state: "PRK",
    district: "Bukit Larut",
    radiusKm: 5,
    points: [{ latitude: 4.8618713, longitude: 100.7930488 }],
  },
  {
    zone: "SBH06",
    state: "SBH",
    district: "Gunung Kinabalu",
    radiusKm: 8,
    points: [{ latitude: 6.0750667, longitude: 116.5587 }],
  },
  {
    zone: "PHG05",
    state: "PHG",
    district: "Genting Sempah, Janda Baik, Bukit Tinggi",
    radiusKm: 12,
    points: [
      { latitude: 3.3505317, longitude: 101.7906654 },
      { latitude: 3.3492085, longitude: 101.8767435 },
      { latitude: 3.349103, longitude: 101.8217663 },
    ],
  },
  {
    zone: "PHG07",
    state: "PHG",
    district: "Zon Khas Daerah Rompin, (Mukim Rompin, Mukim Endau, Mukim Pontian)",
    radiusKm: 18,
    points: [
      { latitude: 2.80581, longitude: 103.488504 },
      { latitude: 2.6602714, longitude: 103.543876 },
      { latitude: 2.6688194, longitude: 103.3306432 },
    ],
  },
  {
    zone: "SWK09",
    state: "SWK",
    district: "Zon Khas (Kampung Patarikan)",
    radiusKm: 10,
    points: [{ latitude: 4.9568855, longitude: 115.5063837 }],
  },
];

function normalizeDistrictName(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function toNumber(value: number | string) {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

function haversineDistanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(deltaLongitude / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function lookupSpecialZone(latitude: number, longitude: number): ZoneMatch | null {
  for (const rule of SPECIAL_ZONE_RULES) {
    for (const point of rule.points) {
      const distanceKm = haversineDistanceKm(
        latitude,
        longitude,
        point.latitude,
        point.longitude,
      );
      if (distanceKm <= rule.radiusKm) {
        return {
          zone: rule.zone,
          state: rule.state,
          district: rule.district,
        };
      }
    }
  }

  return null;
}

export function resolveJakimCode(properties: ZoneFeatureProperties) {
  const state = properties.state?.toUpperCase();
  const district = normalizeDistrictName(properties.name);

  if (state === "PRK" && district in PERAK_DISTRICT_ZONE_MAP) {
    return PERAK_DISTRICT_ZONE_MAP[district];
  }

  return properties.jakim_code;
}

export function lookupZone(geojsonData: any, latitude: number | string, longitude: number | string) {
  const parsedLatitude = toNumber(latitude);
  const parsedLongitude = toNumber(longitude);

  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
    return null;
  }

  const specialZoneMatch = lookupSpecialZone(parsedLatitude, parsedLongitude);
  if (specialZoneMatch) {
    return specialZoneMatch;
  }

  const lookup = new PolygonLookup(geojsonData);
  const result = lookup.search(parsedLongitude, parsedLatitude);

  if (!result?.properties) {
    return null;
  }

  const properties = result.properties as ZoneFeatureProperties;
  const jakimCode = resolveJakimCode(properties);
  if (!jakimCode) {
    return null;
  }

  return {
    zone: jakimCode,
    state: properties.state,
    district: properties.name,
  };
}
