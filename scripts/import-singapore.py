#!/usr/bin/env python3
"""
One-time import script: converts singapore-prayer-time.json → Supabase prayer_months rows.
Zone: SGP01  |  Year: 2026  |  Timezone: SGT (UTC+8)

Time format in source: "hmm" or "hhmm" as a string, e.g. "544" = 05:44, "110" = 13:10
Prayer AM/PM rules:
  fajr / syuruk  → AM (no adjustment)
  dhuhr / asr / maghrib / isha → PM (add 12 if hour < 12)
"""

import json, re, os, sys, urllib.request, urllib.error
from datetime import datetime, timezone, timedelta
from hijri_converter import convert as hijri_convert

SGT = timezone(timedelta(hours=8))
ZONE = "SGP01"
MONTH_NAMES = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("❌ Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars")

# ── Parse source file ─────────────────────────────────────────────────────────

raw = open(os.path.join(os.path.dirname(__file__), "../singapore-prayer-time.json")).read()

# Strip the non-JSON header line ("Singapore prayer time"=) and wrap into array.
# File format: line 0 is label, remaining lines are objects + spurious "[" separators
# between some months. Remove all bare "[" lines then wrap in array.
lines = raw.splitlines()
cleaned = [l for l in lines[1:] if l.strip() != "["]
json_body = "[" + "\n".join(cleaned)  # prepend [; file already ends with ]
entries = json.loads(json_body)

# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_hhmm(s: str, pm: bool) -> tuple[int, int]:
    """Parse "hmm"/"hhmm" string (with optional thousands commas) into (hour_24, minute)."""
    s = s.strip().replace(",", "")  # strip thousands-separator commas e.g. "1,258" → "1258"
    minute = int(s[-2:])
    hour = int(s[:-2]) if len(s) > 2 else int(s[0])
    if pm and hour < 12:
        hour += 12
    return hour, minute

def to_unix(year: int, month: int, day: int, hour: int, minute: int) -> int:
    dt = datetime(year, month, day, hour, minute, tzinfo=SGT)
    return int(dt.timestamp())

def hijri_str(year: int, month: int, day: int) -> str:
    h = hijri_convert.Gregorian(year, month, day).to_hijri()
    return f"{h.year}-{h.month:02d}-{h.day:02d}"

# ── Convert entries ───────────────────────────────────────────────────────────

# Group by (year, month_num)
from collections import defaultdict
months: dict[tuple[int,int], list[dict]] = defaultdict(list)

for e in entries:
    day_str, month_str, year_str = e["Date"].split("/")
    d, m, y = int(day_str), int(month_str), int(year_str)

    fajr_h,    fajr_m    = parse_hhmm(e["Subuh"],   pm=False)
    syuruk_h,  syuruk_m  = parse_hhmm(e["Syuruk"],  pm=False)
    dhuhr_h,   dhuhr_m   = parse_hhmm(e["Zohor"],   pm=True)
    asr_h,     asr_m     = parse_hhmm(e["Asar"],    pm=True)
    maghrib_h, maghrib_m = parse_hhmm(e["Maghrib"], pm=True)
    isha_h,    isha_m    = parse_hhmm(e["Isyak"],   pm=True)

    prayer_row = {
        "day":     d,
        "hijri":   hijri_str(y, m, d),
        "fajr":    to_unix(y, m, d, fajr_h,    fajr_m),
        "syuruk":  to_unix(y, m, d, syuruk_h,  syuruk_m),
        "dhuhr":   to_unix(y, m, d, dhuhr_h,   dhuhr_m),
        "asr":     to_unix(y, m, d, asr_h,     asr_m),
        "maghrib": to_unix(y, m, d, maghrib_h, maghrib_m),
        "isha":    to_unix(y, m, d, isha_h,    isha_m),
    }
    months[(y, m)].append(prayer_row)

# Sort each month's prayers by day
for key in months:
    months[key].sort(key=lambda p: p["day"])

# ── Ensure zone exists ────────────────────────────────────────────────────────

def supabase_request(path: str, method: str, body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", SUPABASE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=merge-duplicates,return=minimal")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

print("📍 Ensuring zone SGP01 exists in zones table...")
status, body = supabase_request(
    "zones?on_conflict=code",
    "POST",
    [{"code": ZONE, "negeri": "Singapore", "daerah": "Singapore"}]
)
if status in (200, 201, 204):
    print(f"  ✅ Zone {ZONE} upserted (HTTP {status})")
else:
    sys.exit(f"  ❌ Failed to upsert zone: {status} {body}")

print(f"✅ Parsed {len(entries)} days across {len(months)} months")

# Sanity-check a few rows
for (y, m), rows in sorted(months.items())[:2]:
    r = rows[0]
    dt_fajr = datetime.fromtimestamp(r["fajr"], tz=SGT)
    dt_isha  = datetime.fromtimestamp(r["isha"],  tz=SGT)
    print(f"  {MONTH_NAMES[m-1]} {y} day {r['day']}: fajr={dt_fajr.strftime('%H:%M')} isha={dt_isha.strftime('%H:%M')} hijri={r['hijri']}")

# ── Upsert to Supabase ────────────────────────────────────────────────────────

def supabase_upsert(rows: list[dict]):
    status, body = supabase_request("prayer_months?on_conflict=zone,year,month", "POST", rows)
    if status not in (200, 201, 204):
        sys.exit(f"❌ Upsert failed: HTTP {status}: {body}")
    return status

now_iso = datetime.now(timezone.utc).isoformat()
upsert_rows = []

for (year, month_num), prayers in sorted(months.items()):
    upsert_rows.append({
        "zone":         ZONE,
        "year":         year,
        "month":        MONTH_NAMES[month_num - 1],
        "last_updated": now_iso,
        "prayers":      prayers,
    })

print(f"\n📤 Upserting {len(upsert_rows)} month rows to Supabase...")
status = supabase_upsert(upsert_rows)
print(f"✅ Supabase responded with HTTP {status}")
print(f"\nDone! Zone {ZONE} now has 2026 prayer times in prayer_months.")
rm_tmp = os.path.join(os.path.dirname(__file__), "../.env.prod.tmp")
if os.path.exists(rm_tmp):
    os.remove(rm_tmp)
    print("🧹 Cleaned up .env.prod.tmp")
