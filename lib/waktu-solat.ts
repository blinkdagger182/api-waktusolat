const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export type PrayerMonthRecord = {
  zone: string;
  year: number;
  month: string;
  last_updated: string | null;
  prayers: any[];
};

export function getMalaysiaCurrentDate() {
  const utcDate = new Date();
  const gmt8Options = { timeZone: "Asia/Kuala_Lumpur" };
  const gmt8Date = new Intl.DateTimeFormat("en-US", gmt8Options).format(utcDate);
  return new Date(gmt8Date);
}

export function resolveQueryYear(year: string | string[] | undefined, malaysiaCurrentDate: Date) {
  if (!year) {
    return malaysiaCurrentDate.getFullYear();
  }

  const queryYear = parseInt(year.toString(), 10);
  if (Number.isNaN(queryYear)) {
    throw new Error(`Invalid year: ${year.toString()}`);
  }

  return queryYear;
}

export function resolveQueryMonth(month: string | string[] | undefined, malaysiaCurrentDate: Date) {
  if (month === undefined) {
    return malaysiaCurrentDate.toLocaleString("en-US", {
      month: "short",
    }).toUpperCase();
  }

  const monthNumber = parseInt(month.toString(), 10);
  if (Number.isNaN(monthNumber)) {
    throw new Error(`Invalid month: ${month.toString()}`);
  }

  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error(`Invalid month: ${month.toString()}. Please specify month between 1-12`);
  }

  return MONTH_NAMES[monthNumber - 1];
}

export function monthNameToNumber(monthName: string) {
  return MONTH_NAMES.indexOf(monthName.toUpperCase()) + 1;
}
