// America/Chicago calendar-day helpers shared by the daily summarizer and its
// CLI. The zone math mirrors usage.js: no fixed UTC offset, no UTC current_date,
// so spring-forward and fall-back days stay correct.

import { getCentralDay } from './usage.js';

export const SUMMARY_TIME_ZONE = 'America/Chicago';

const centralPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SUMMARY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function zonedParts(date) {
  const result = {};
  for (const part of centralPartsFormatter.formatToParts(date)) {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
  }
  return result;
}

export function centralDayFor(date = new Date()) {
  return getCentralDay(date);
}

export function isCentralDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function addDays(day, n) {
  if (!isCentralDay(day)) throw new TypeError('day must be a YYYY-MM-DD Central calendar day');
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + n));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

// Central wall-clock midnight as an instant. Iterating against the zone's actual
// offset on that date keeps DST boundaries from shifting the day.
function centralMidnight(day) {
  const [year, month, date] = day.split('-').map(Number);
  const target = Date.UTC(year, month - 1, date, 0, 0, 0);
  let instant = target + 6 * 60 * 60 * 1000;
  for (let i = 0; i < 4; i += 1) {
    const p = zonedParts(new Date(instant));
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const adjustment = target - represented;
    instant += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(instant);
}

export function centralDayStartIso(day) {
  if (!isCentralDay(day)) throw new TypeError('day must be a YYYY-MM-DD Central calendar day');
  return centralMidnight(day).toISOString();
}

export function centralDayEndIso(day) {
  return centralDayStartIso(addDays(day, 1));
}

export function centralDayRange(day) {
  return { startIso: centralDayStartIso(day), endIso: centralDayEndIso(day) };
}

export function previousCompletedCentralDay(now = new Date()) {
  return addDays(getCentralDay(now), -1);
}

// Today's Central date plus the six preceding calendar days, inclusive.
export function getDigestWindow(now = new Date()) {
  const endDay = getCentralDay(now);
  return { startDay: addDays(endDay, -6), endDay, timeZone: SUMMARY_TIME_ZONE };
}
