import { financialYear, financialYearShort, istDate } from "@cba/core";

export { istDate };

/** "2026-27" for a date in that financial year (April–March by default). */
export const fyLabel = (isoDate: string, startMonth = 4) => financialYear(isoDate, startMonth);

/** "26-27" — used inside document numbers to stay within GST's 16-character limit. */
export const fyShortLabel = (isoDate: string, startMonth = 4) => financialYearShort(isoDate, startMonth);

export const addSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
export const addDaysDate = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
