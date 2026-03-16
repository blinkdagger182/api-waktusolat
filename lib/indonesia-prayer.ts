const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export type IndonesiaRegionRecord = {
  id: string;
  location: string;
  province: string;
  timezone: string;
};

export type IndonesiaPrayerDay = {
  date: string;
  day: number;
  imsak: string;
  fajr: string;
  syuruk: string;
  dhuha: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
};

export type IndonesiaPrayerMonthRecord = {
  region_id: string;
  year: number;
  month: string;
  month_number: number;
  timezone: string;
  location: string;
  province: string;
  last_updated: string | null;
  prayers: IndonesiaPrayerDay[];
};

export type IndonesiaRegionMatchInput = {
  city?: string | null;
  locality?: string | null;
  regency?: string | null;
  subAdministrativeArea?: string | null;
  province?: string | null;
};

export type IndonesiaRegionMatchCandidate = {
  region: IndonesiaRegionRecord;
  score: number;
  matched_on: string[];
};

const PROVINCE_TIMEZONE_MAP: Record<string, string> = {
  ACEH: "Asia/Jakarta",
  "SUMATERA UTARA": "Asia/Jakarta",
  "SUMATERA BARAT": "Asia/Jakarta",
  RIAU: "Asia/Jakarta",
  JAMBI: "Asia/Jakarta",
  "SUMATERA SELATAN": "Asia/Jakarta",
  BENGKULU: "Asia/Jakarta",
  LAMPUNG: "Asia/Jakarta",
  "KEPULAUAN BANGKA BELITUNG": "Asia/Jakarta",
  "KEPULAUAN RIAU": "Asia/Jakarta",
  "DKI JAKARTA": "Asia/Jakarta",
  "JAWA BARAT": "Asia/Jakarta",
  "JAWA TENGAH": "Asia/Jakarta",
  DIJ: "Asia/Jakarta",
  "D.I. YOGYAKARTA": "Asia/Jakarta",
  "DAERAH ISTIMEWA YOGYAKARTA": "Asia/Jakarta",
  "JAWA TIMUR": "Asia/Jakarta",
  BANTEN: "Asia/Jakarta",
  BALI: "Asia/Makassar",
  "NUSA TENGGARA BARAT": "Asia/Makassar",
  "NUSA TENGGARA TIMUR": "Asia/Makassar",
  "KALIMANTAN BARAT": "Asia/Pontianak",
  "KALIMANTAN TENGAH": "Asia/Jakarta",
  "KALIMANTAN SELATAN": "Asia/Makassar",
  "KALIMANTAN TIMUR": "Asia/Makassar",
  "KALIMANTAN UTARA": "Asia/Makassar",
  "SULAWESI UTARA": "Asia/Makassar",
  "SULAWESI TENGAH": "Asia/Makassar",
  "SULAWESI SELATAN": "Asia/Makassar",
  "SULAWESI TENGGARA": "Asia/Makassar",
  GORONTALO: "Asia/Makassar",
  "SULAWESI BARAT": "Asia/Makassar",
  MALUKU: "Asia/Jayapura",
  "MALUKU UTARA": "Asia/Jayapura",
  PAPUA: "Asia/Jayapura",
  "PAPUA BARAT": "Asia/Jayapura",
  "PAPUA SELATAN": "Asia/Jayapura",
  "PAPUA TENGAH": "Asia/Jayapura",
  "PAPUA PEGUNUNGAN": "Asia/Jayapura",
  "PAPUA BARAT DAYA": "Asia/Jayapura",
};

export function monthNameFromNumber(monthNumber: number) {
  return MONTH_NAMES[monthNumber - 1];
}

export function monthNumberFromName(monthName: string) {
  return MONTH_NAMES.indexOf(monthName.toUpperCase()) + 1;
}

export function resolveIndonesiaTimezone(province: string) {
  return PROVINCE_TIMEZONE_MAP[province.toUpperCase()] ?? "Asia/Jakarta";
}

export function normalizeIndonesiaPlaceName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[.,/()-]/g, " ")
    .replace(/\bKABUPATEN\b/g, "KAB")
    .replace(/\bKOTA ADMINISTRASI\b/g, "KOTA")
    .replace(/\bKOTA ADM\b/g, "KOTA")
    .replace(/\bKOTA\b/g, "KOTA")
    .replace(/\bKAB\b/g, "KAB")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function stripAdministrativePrefix(value: string) {
  return value
    .replace(/^KAB\.?\s+/g, "")
    .replace(/^KOTA\s+/g, "")
    .replace(/^KOTA ADM\.?\s+/g, "")
    .replace(/^KOTA ADMINISTRASI\s+/g, "")
    .trim();
}

function tokenOverlapScore(left: string, right: string) {
  const leftTokens = new Set(stripAdministrativePrefix(left).split(" ").filter(Boolean));
  const rightTokens = new Set(stripAdministrativePrefix(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  });

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

export function findBestIndonesiaRegionMatch(
  regions: IndonesiaRegionRecord[],
  input: IndonesiaRegionMatchInput,
): { match: IndonesiaRegionMatchCandidate | null; candidates: IndonesiaRegionMatchCandidate[] } {
  const province = input.province ? normalizeIndonesiaPlaceName(input.province) : null;
  const names = uniqueNonEmpty([
    input.city,
    input.locality,
    input.regency,
    input.subAdministrativeArea,
  ]).map((value) => normalizeIndonesiaPlaceName(value));

  if (names.length === 0) {
    return {
      match: null,
      candidates: [],
    };
  }

  const candidates = regions
    .map((region) => {
      const regionProvince = normalizeIndonesiaPlaceName(region.province);
      const regionLocation = normalizeIndonesiaPlaceName(region.location);
      const regionCore = stripAdministrativePrefix(regionLocation);
      let score = 0;
      const matchedOn: string[] = [];

      for (const name of names) {
        const nameCore = stripAdministrativePrefix(name);
        if (name === regionLocation) {
          score = Math.max(score, 100);
          matchedOn.push(`exact:${name}`);
          continue;
        }

        if (nameCore === regionCore) {
          score = Math.max(score, 96);
          matchedOn.push(`core:${name}`);
          continue;
        }

        if (regionLocation.includes(name) || name.includes(regionLocation)) {
          score = Math.max(score, 88);
          matchedOn.push(`contains:${name}`);
          continue;
        }

        if (regionCore.includes(nameCore) || nameCore.includes(regionCore)) {
          score = Math.max(score, 84);
          matchedOn.push(`core-contains:${name}`);
          continue;
        }

        const overlapScore = tokenOverlapScore(regionLocation, name);
        if (overlapScore >= 0.75) {
          score = Math.max(score, 78);
          matchedOn.push(`tokens:${name}`);
          continue;
        }

        if (overlapScore >= 0.5) {
          score = Math.max(score, 68);
          matchedOn.push(`partial-tokens:${name}`);
        }
      }

      if (province) {
        if (province === regionProvince) {
          score += 12;
          matchedOn.push(`province:${province}`);
        } else if (score > 0) {
          score -= 18;
          matchedOn.push(`province-mismatch:${province}`);
        }
      }

      return {
        region,
        score,
        matched_on: matchedOn,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.region.location.localeCompare(right.region.location));

  const best = candidates[0] ?? null;
  if (!best) {
    return { match: null, candidates: [] };
  }

  const second = candidates[1];
  const confident = best.score >= 80 && (!second || best.score - second.score >= 8);

  return {
    match: confident ? best : null,
    candidates: candidates.slice(0, 5),
  };
}

export function normalizeIndonesiaPrayerMonth(payload: any): IndonesiaPrayerMonthRecord {
  const monthEntries = Object.entries(payload.data.jadwal);
  const firstDate = monthEntries.length > 0 ? monthEntries[0][0] : "";
  const [, monthPart] = firstDate.split("-");
  const monthNumber = Number.parseInt(monthPart ?? "1", 10);
  const timezone = resolveIndonesiaTimezone(payload.data.prov);

  return {
    region_id: payload.data.id,
    year: Number.parseInt(firstDate.slice(0, 4), 10),
    month: monthNameFromNumber(monthNumber),
    month_number: monthNumber,
    timezone,
    location: payload.data.kabko,
    province: payload.data.prov,
    last_updated: null,
    prayers: monthEntries.map(([date, times]: [string, any]) => ({
      date,
      day: Number.parseInt(date.slice(-2), 10),
      imsak: times.imsak,
      fajr: times.subuh,
      syuruk: times.terbit,
      dhuha: times.dhuha,
      dhuhr: times.dzuhur,
      asr: times.ashar,
      maghrib: times.maghrib,
      isha: times.isya,
    })),
  };
}
