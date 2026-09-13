// Tiny AI-token capacity indicator for the dashboard heading.
// Placeholder values for now: wire `used` / `limit` to useUsage() (GET /ai/usage) later.
export default function TokenUsageBar({ used = 12500, limit = 50000, label = 'AI tokens today' }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const warn = pct >= 80;
  return (
    <div className={`usage-bar ${warn ? 'warn' : ''}`} title={`${used.toLocaleString()} of ${limit.toLocaleString()} ${label}`}>
      <span
        className="usage-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <span className="usage-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="usage-text">{pct}% used</span>
    </div>
  );
}
