const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const tzName = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
  .formatToParts(new Date())
  .find((p) => p.type === "timeZoneName")?.value;

export const localTimeZone = tzName ?? tz;

export function duration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function miles(v: number): string {
  if (v === 0) return "0 mi";
  if (v < 10) return `${v.toFixed(1)} mi`;
  return `${Math.round(v).toLocaleString()} mi`;
}

export function clock(iso: string | Date): string {
  return timeFmt.format(new Date(iso));
}

/** "Sat 3:20 PM", or just "3:20 PM" when it is the same day as ``relativeTo``. */
export function dayClock(iso: string | Date, relativeTo?: string | Date): string {
  const d = new Date(iso);
  if (relativeTo && new Date(relativeTo).toDateString() === d.toDateString()) return timeFmt.format(d);
  return dayTimeFmt.format(d);
}

export function day(iso: string | Date): string {
  return dayFmt.format(new Date(iso));
}

export function lb(v: number): string {
  return `${Math.round(v).toLocaleString()} lb`;
}

/** Value for <input type="datetime-local"> in the user's zone. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nextQuarterHour(from = new Date(), addMinutes = 60): Date {
  const d = new Date(from.getTime() + addMinutes * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}
