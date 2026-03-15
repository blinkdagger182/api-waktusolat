import PolygonLookup from "polygon-lookup";

type ZoneFeatureProperties = {
  jakim_code?: string;
  state?: string;
  name?: string;
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

function normalizeDistrictName(value?: string) {
  return value?.trim().toLowerCase() ?? "";
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
  const lookup = new PolygonLookup(geojsonData);
  const result = lookup.search(longitude, latitude);

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
