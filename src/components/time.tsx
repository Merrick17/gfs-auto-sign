"use client";

// Dates are rendered in the viewer's own time zone. The server's rendering may differ by zone, so the
// text is allowed to change on hydration.

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function formatShort(d: Date, now = new Date()) {
  if (sameDay(d, now)) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

export function formatLong(d: Date, now = new Date()) {
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, now)) return `Today, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })}, ${time}`;
}

export function formatPrecise(d: Date, now = new Date()) {
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return sameDay(d, now) ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

const FORMAT = { short: formatShort, long: formatLong, precise: formatPrecise };

export function Time({ value, format = "short", className }: { value: Date | string; format?: keyof typeof FORMAT; className?: string }) {
  const d = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={d.toISOString()} title={d.toLocaleString()} className={className} suppressHydrationWarning>
      {FORMAT[format](d)}
    </time>
  );
}
