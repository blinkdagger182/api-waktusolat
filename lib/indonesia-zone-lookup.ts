import PolygonLookup from "polygon-lookup";
import path from "path";
import fsPromises from "fs/promises";

type IndonesiaZoneFeatureProperties = {
  region_id: string;
  location: string;
  province: string;
};

export type IndonesiaZoneMatch = {
  region_id: string;
  location: string;
  province: string;
};

let cachedGeoJson: any = null;

export async function loadIndonesiaGeoJson(): Promise<any> {
  if (cachedGeoJson) return cachedGeoJson;
  const filePath = path.join(process.cwd(), "json", "indonesia-districts.geojson");
  const jsonData = await fsPromises.readFile(filePath, "utf-8");
  cachedGeoJson = JSON.parse(jsonData);
  return cachedGeoJson;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

export function lookupIndonesiaZone(
  geojsonData: any,
  latitude: number | string,
  longitude: number | string
): IndonesiaZoneMatch | null {
  const parsedLat = toNumber(latitude);
  const parsedLng = toNumber(longitude);

  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return null;
  }

  const lookup = new PolygonLookup(geojsonData);
  // polygon-lookup expects (longitude, latitude)
  const result = lookup.search(parsedLng, parsedLat);

  if (!result?.properties?.region_id) {
    return null;
  }

  const props = result.properties as IndonesiaZoneFeatureProperties;
  return {
    region_id: props.region_id,
    location: props.location,
    province: props.province,
  };
}
