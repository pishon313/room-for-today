export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const today = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export const date = (s: string) => new Date(s + "T12:00:00Z");
export const key = (d: Date) => d.toISOString().slice(0, 10);
export const shift = (s: string, n: number) => {
  const d = date(s);
  d.setUTCDate(d.getUTCDate() + n);
  return key(d);
};
export const weekStart = (s: string) =>
  shift(s, -((date(s).getUTCDay() + 6) % 7));
export const weekDays = (s: string) =>
  Array.from({ length: 7 }, (_, i) => shift(weekStart(s), i));
export const monthShift = (s: string, n: number) => {
  const d = date(s);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return key(d);
};
export const calendar = (s: string) => {
  const start = weekStart(s.slice(0, 7) + "-01");
  return Array.from({ length: 42 }, (_, i) => shift(start, i));
};
export const label = (s: string, options: Intl.DateTimeFormatOptions) =>
  date(s).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
