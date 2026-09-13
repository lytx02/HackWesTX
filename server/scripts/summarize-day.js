// End-of-day summary command. Default: the previous completed Central day.
//   node --env-file-if-exists=.env scripts/summarize-day.js
//   node --env-file-if-exists=.env scripts/summarize-day.js --day 2026-09-13
//   node --env-file-if-exists=.env scripts/summarize-day.js --catch-up-days 7
// Nightly runs pass no billing callbacks: automatic summaries are system cost.

import { pool } from '../src/db.js';
import { summarizeDay } from '../src/summaries.js';
import { addDays, isCentralDay, previousCompletedCentralDay } from '../src/summary-time.js';

const MAX_CATCH_UP_DAYS = 31;

function parseArgs(argv) {
  const options = { day: null, catchUpDays: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== '--day' && arg !== '--catch-up-days') throw new Error(`Unknown argument "${arg}"`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${arg} requires a value`);
    if (arg === '--day') {
      if (!isCentralDay(value)) throw new Error(`--day must be a YYYY-MM-DD Central calendar day, got "${value}"`);
      options.day = value;
    } else {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_CATCH_UP_DAYS) {
        throw new Error(`--catch-up-days must be an integer between 1 and ${MAX_CATCH_UP_DAYS}`);
      }
      options.catchUpDays = Number(value);
    }
    i += 1;
  }
  if (options.day && options.catchUpDays) throw new Error('Use either --day or --catch-up-days, not both');
  return options;
}

// The last N completed Central days, oldest first.
function planDays({ day, catchUpDays }, now = new Date()) {
  if (day) return [day];
  const lastCompleted = previousCompletedCentralDay(now);
  if (!catchUpDays) return [lastCompleted];
  const days = [];
  for (let offset = catchUpDays; offset >= 1; offset -= 1) days.push(addDays(lastCompleted, -(offset - 1)));
  return days;
}

try {
  const days = planDays(parseArgs(process.argv.slice(2)));
  for (const day of days) {
    const counts = await summarizeDay({ day });
    console.log(`${day}: scanned=${counts.scanned} updated=${counts.updated} skipped=${counts.skipped} failed=${counts.failed}`);
    if (counts.failed) process.exitCode = 1;
  }
} catch (error) {
  console.error(`summarize-day failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
