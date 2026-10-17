const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
const shortDayFmt = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function daysAgo(d: Date): number {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((start(new Date()) - start(d)) / 86_400_000);
}

// "18:04"
export function clock(d: Date): string {
  return timeFmt.format(d);
}

// "Today at 18:04", "Yesterday at 18:04", "14/10/2026 18:04"
export function stamp(d: Date): string {
  const ago = daysAgo(d);
  if (ago === 0) return `Today at ${clock(d)}`;
  if (ago === 1) return `Yesterday at ${clock(d)}`;
  return `${shortDayFmt.format(d)} ${clock(d)}`;
}

// "October 16, 2026" for the date dividers.
export function day(d: Date): string {
  return dayFmt.format(d);
}

export function full(d: Date): string {
  return fullFmt.format(d);
}
