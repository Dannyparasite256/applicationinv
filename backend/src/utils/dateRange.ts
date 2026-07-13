import { endOfDay, startOfDay } from 'date-fns';
import type { Request } from 'express';

/**
 * Parse query date params safely.
 * Date-only strings (YYYY-MM-DD) are treated as calendar days in UTC so
 * multi-day ranges (week/month) include full days on Render (UTC) and
 * match local "from/to" pickers without timezone shifts from `new Date(iso)`.
 */
export function parseQueryDate(
  value: string | undefined | null,
  boundary: 'start' | 'end'
): Date | undefined {
  if (value == null || value === '') return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;

  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dayOnly) {
    const y = Number(dayOnly[1]);
    const m = Number(dayOnly[2]);
    const d = Number(dayOnly[3]);
    if (boundary === 'start') {
      return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    }
    return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return boundary === 'start' ? startOfDay(parsed) : endOfDay(parsed);
}

/** Read `from` / `to` query params as inclusive full-day bounds. */
export function parseQueryDateRange(req: Request): { from?: Date; to?: Date } {
  return {
    from: parseQueryDate(
      typeof req.query.from === 'string' ? req.query.from : undefined,
      'start'
    ),
    to: parseQueryDate(typeof req.query.to === 'string' ? req.query.to : undefined, 'end'),
  };
}

/** Local calendar YYYY-MM-DD (for clients building range filters). */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
