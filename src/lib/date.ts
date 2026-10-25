/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parses YYYY-MM-DD as local midnight. */
export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  const d = parseIsoDate(date);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000);
}

export function today(): string {
  return isoDate(new Date());
}

export type ApiDate = { year: number; month: number; day: number };

export function fromApiDate(d: ApiDate | undefined | null): string | null {
  if (!d?.year) return null;
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export function toApiDate(date: string): ApiDate {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

export function ageFrom(birthDate: string, on: Date = new Date()): number {
  const b = parseIsoDate(birthDate);
  let age = on.getFullYear() - b.getFullYear();
  const beforeBirthday =
    on.getMonth() < b.getMonth() || (on.getMonth() === b.getMonth() && on.getDate() < b.getDate());
  if (beforeBirthday) age--;
  return age;
}

/** Minutes since local midnight for an ISO timestamp. */
export function minutesOfDay(ts: string | number | Date): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !isFinite(minutes)) return '—';
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export function shortDay(date: string): string {
  return parseIsoDate(date).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
}

export function friendlyDate(date: string): string {
  if (date === today()) return 'Today';
  if (date === addDays(today(), -1)) return 'Yesterday';
  return parseIsoDate(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function relativeTime(ts: string | number | null | undefined): string {
  if (ts == null) return 'never';
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
