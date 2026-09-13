import { eq, sql } from 'drizzle-orm';
import { db } from './db.js';
import { users } from './schema.js';
import { HttpError, notFound } from './http.js';

export const USAGE_TIME_ZONE = 'America/Chicago';
export const DEFAULT_DAILY_TOKEN_LIMIT = 50_000;
export const MISSING_USAGE_COMPLETION_ESTIMATE = 1024;

export function parseDailyTokenLimit(raw = process.env.DAILY_TOKEN_LIMIT) {
  if (raw === undefined) return DEFAULT_DAILY_TOKEN_LIMIT;
  const text = String(raw).trim();
  const value = Number(text);
  if (!text || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('DAILY_TOKEN_LIMIT must be a positive safe integer');
  }
  return value;
}

// Evaluated during module loading so an invalid configured value prevents the
// API from starting instead of silently changing enforcement behavior.
export const DAILY_TOKEN_LIMIT = parseDailyTokenLimit();

const centralPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: USAGE_TIME_ZONE,
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

export function getCentralDay(now = new Date()) {
  const { year, month, day } = zonedParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function nextCalendarDay(day) {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

// Convert a Central wall-clock midnight to an instant without assuming a fixed
// UTC offset. The iteration observes the zone's actual offset on that date, so
// spring-forward and fall-back boundaries produce 23- and 25-hour usage days.
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

export function getNextCentralMidnight(now = new Date()) {
  return centralMidnight(nextCalendarDay(getCentralDay(now)));
}

export class UsageError extends HttpError {
  constructor(status, message, code, metadata = {}) {
    super(status, message, code);
    Object.assign(this, metadata);
  }
}

function quotaError(limit, resetsAt) {
  return new UsageError(
    429,
    `You have used your ${limit.toLocaleString('en-US')}-token allowance. Come back after ${resetsAt}.`,
    'ai_quota_exceeded',
    { limit, resetsAt }
  );
}

function inProgressError() {
  return new UsageError(409, 'An AI request is already in progress for this account.', 'ai_request_in_progress');
}

function normalizeUsage(value) {
  if (value == null) {
    // Generic callers should normally supply their own input/output estimate.
    // This non-zero fallback ensures an admitted call can never become a silent
    // free call merely because a provider omitted its terminal usage object.
    return {
      promptTokens: 1,
      completionTokens: MISSING_USAGE_COMPLETION_ESTIMATE,
      source: 'estimated',
    };
  }
  const { promptTokens, completionTokens, source } = value;
  if (!Number.isSafeInteger(promptTokens) || promptTokens < 0
    || !Number.isSafeInteger(completionTokens) || completionTokens < 0
    || !['reported', 'estimated'].includes(source)) {
    throw new TypeError('usage must contain nonnegative safe-integer promptTokens/completionTokens and a reported or estimated source');
  }
  if (!Number.isSafeInteger(promptTokens + completionTokens)) {
    throw new TypeError('total token usage must be a safe integer');
  }
  return { promptTokens, completionTokens, source };
}

const productionStore = {
  async read(userId) {
    const [row] = await db
      .select({ aiUsageDay: users.aiUsageDay, aiTokensUsed: users.aiTokensUsed })
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  },

  async settle(userId, admittedDay, tokens) {
    const [row] = await db
      .update(users)
      .set({
        aiUsageDay: sql`case
          when ${users.aiUsageDay} is null or ${users.aiUsageDay} < ${admittedDay}::date then ${admittedDay}::date
          else ${users.aiUsageDay}
        end`,
        aiTokensUsed: sql`case
          when ${users.aiUsageDay} = ${admittedDay}::date then ${users.aiTokensUsed} + ${tokens}
          when ${users.aiUsageDay} is null or ${users.aiUsageDay} < ${admittedDay}::date then ${tokens}
          else ${users.aiTokensUsed}
        end`,
      })
      .where(eq(users.id, userId))
      .returning({ aiUsageDay: users.aiUsageDay, aiTokensUsed: users.aiTokensUsed });
    if (!row) throw notFound('User not found');
    return row;
  },
};

export function createUsageService({
  store = productionStore,
  limit = DAILY_TOKEN_LIMIT,
  now = () => new Date(),
} = {}) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('limit must be a positive safe integer');
  const activeUsers = new Set();

  async function usageSnapshot(userId, at = now()) {
    const row = await store.read(userId);
    if (!row) throw notFound('User not found');
    const day = getCentralDay(at);
    const used = row.aiUsageDay === day ? row.aiTokensUsed : 0;
    const resetsAt = getNextCentralMidnight(at).toISOString();
    return { limit, used, remaining: Math.max(0, limit - used), resetsAt };
  }

  async function getUsage(userId) {
    return usageSnapshot(userId);
  }

  async function withUsageBudget(userId, work) {
    if (typeof work !== 'function') throw new TypeError('withUsageBudget requires a callback');
    if (activeUsers.has(userId)) throw inProgressError();
    activeUsers.add(userId);

    let pendingDay = null;
    try {
      const usage = await usageSnapshot(userId);
      if (usage.used >= limit) throw quotaError(limit, usage.resetsAt);

      const beforeModelCall = async () => {
        if (pendingDay) throw new Error('recordUsage must be awaited before starting another model call');
        const checkedAt = now();
        const current = await usageSnapshot(userId, checkedAt);
        if (current.used >= limit) throw quotaError(limit, current.resetsAt);
        pendingDay = getCentralDay(checkedAt);
        return current;
      };

      const recordUsage = async (reported) => {
        if (!pendingDay) throw new Error('beforeModelCall must be awaited before recordUsage');
        const admittedDay = pendingDay;
        // Consume the admission before writing so the same inference is never
        // submitted twice after an ambiguous database/network failure.
        pendingDay = null;
        const normalized = normalizeUsage(reported);
        await store.settle(userId, admittedDay, normalized.promptTokens + normalized.completionTokens);
        return normalized;
      };

      try {
        return await work({ beforeModelCall, recordUsage, usage });
      } finally {
        // If a caller exits after admission without reaching its normal usage
        // callback, conservatively settle once before releasing the user gate.
        if (pendingDay) await recordUsage(null);
      }
    } finally {
      activeUsers.delete(userId);
    }
  }

  return { getUsage, withUsageBudget };
}

const service = createUsageService();
export const getUsage = service.getUsage;
export const withUsageBudget = service.withUsageBudget;
