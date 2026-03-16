export const DEFAULT_MONTHLY_POOL_TARGET = 150;
export const DEFAULT_MONTHLY_POOL_CAP = 1000;
export const DONATION_POOL_TIME_ZONE = "Asia/Kuala_Lumpur";

export type DonationPoolMonthlyRecord = {
  month_start: string;
  total_amount: number;
  target_amount: number;
  cap_amount: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DonationPoolSnapshot = {
  month: string;
  monthStart: string;
  totalAmount: number;
  targetAmount: number;
  capAmount: number;
  progress: number;
};

function formatDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DONATION_POOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Could not determine donation pool month");
  }

  return { year, month, day };
}

export function getCurrentDonationPoolMonthStart(now = new Date()) {
  const { year, month } = formatDateParts(now);
  return `${year}-${month}-01`;
}

export function normalizeDonationPoolMonthStart(value: unknown, fallback = getCurrentDonationPoolMonthStart()) {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim();

  if (/^\d{4}-\d{2}$/.test(normalized)) {
    return `${normalized}-01`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return `${normalized.slice(0, 7)}-01`;
  }

  return fallback;
}

export function toDonationPoolSnapshot(record: Partial<DonationPoolMonthlyRecord> | null | undefined, monthStart = getCurrentDonationPoolMonthStart()): DonationPoolSnapshot {
  const totalAmount = Number(record?.total_amount ?? 0);
  const capAmount = Number(record?.cap_amount ?? DEFAULT_MONTHLY_POOL_CAP);
  const targetAmount = Math.min(
    capAmount,
    Math.max(1, Number(record?.target_amount ?? DEFAULT_MONTHLY_POOL_TARGET))
  );
  const boundedTotal = Math.max(0, totalAmount);
  const progress = targetAmount > 0 ? Math.min(1, boundedTotal / targetAmount) : 0;

  return {
    month: monthStart.slice(0, 7),
    monthStart,
    totalAmount: boundedTotal,
    targetAmount,
    capAmount,
    progress: Number(progress.toFixed(4)),
  };
}

