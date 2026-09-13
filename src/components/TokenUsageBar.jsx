import { useUsage } from '../api/hooks.js';

// Tiny AI-token capacity indicator for the dashboard heading. The API projects
// a stale PostgreSQL usage day as zero, so the browser never needs to calculate
// daily rollover itself.
export default function TokenUsageBar({ label = 'AI tokens today' }) {
  const usage = useUsage();

  if (usage.isPending) {
    return <div className="usage-bar" role="status">Loading token usage...</div>;
  }

  if (usage.isError) {
    return <div className="usage-bar" role="status">Token usage unavailable</div>;
  }

  const used = Number.isFinite(usage.data?.used) ? usage.data.used : 0;
  const limit = Number.isFinite(usage.data?.limit) ? usage.data.limit : 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const warn = pct >= 80;
  const resetsAt = usage.data?.resetsAt ? new Date(usage.data.resetsAt) : null;
  const resetText = resetsAt && !Number.isNaN(resetsAt.getTime())
    ? ` Resets ${resetsAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`
    : '';

  return (
    <div
      className={`usage-bar ${warn ? 'warn' : ''}`}
      title={`${used.toLocaleString()} of ${limit.toLocaleString()} ${label}.${resetText}`}
    >
      <span
        className="usage-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
      >
        <span className="usage-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="usage-text">
        {used.toLocaleString()} of {limit.toLocaleString()} tokens today ({pct}%)
      </span>
    </div>
  );
}
