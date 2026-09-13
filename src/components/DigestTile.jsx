import Tile from './Tile.jsx';
import { describeChatError } from './AgentChat.jsx';
import { useDigest, useGenerateDigest, useUsage } from '../api/hooks.js';
import { parseISO } from '../data/week.js';

// Server dates are YYYY-MM-DD; render in the viewer's locale.
const fmtDay = (iso) => parseISO(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

// Instants (createdAt, resetsAt) arrive as ISO strings; never recompute the reset.
const fmtWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

// Instructor-only tile over GET /classes/:id/digest. The last successful run
// stays on screen while a generation is pending or has failed.
export default function DigestTile({ classId, span = 8 }) {
  const q = useDigest(classId);
  const gen = useGenerateDigest(classId);
  const usage = useUsage(Boolean(classId));

  const run = q.data?.run ?? null;
  const items = Array.isArray(q.data?.items) ? q.data.items : [];
  const error = gen.error ?? (q.isError ? q.error : null);
  const u = usage.data;

  return (
    <Tile
      title="What students struggled with this week"
      span={span}
      className="digest-tile"
      action={<span className="chip chip-agent">✦ AI weekly brief</span>}
    >
      <div className="digest-source">
        <span className="digest-source-icon" aria-hidden="true">✦</span>
        <div>
          <div className="digest-source-title">Built from recent student conversations</div>
          <p>
            AI combines anonymous conversation summaries from the last seven days to surface common questions and areas of
            confusion. Individual students are not identified.
          </p>
        </div>
      </div>

      {q.isLoading ? (
        <p className="muted digest-state">Loading the latest seven-day digest...</p>
      ) : run ? (
        <>
          <div className="digest-meta">
            <span>
              <strong>{fmtDay(run.windowStartDay)} – {fmtDay(run.windowEndDay)}</strong>
            </span>
            <span>
              {run.summaryCount} {run.summaryCount === 1 ? 'conversation summary' : 'conversation summaries'} · {run.studentCount}{' '}
              {run.studentCount === 1 ? 'student' : 'students'}
            </span>
            <span>Updated {fmtWhen(run.createdAt)}</span>
          </div>
          {items.length === 0 ? (
            <div className="digest-empty">
              <div className="digest-empty-title">No shared areas of difficulty found</div>
              <p>The recent student summaries did not show a recurring struggle for the class.</p>
            </div>
          ) : (
            <ul className="digest">
              {items.map((item) => (
                <li key={item.id ?? item.rank} className={`digest-item ${item.kind}`}>
                  <span className="digest-rank" aria-label={`Priority ${item.rank}`}>{item.rank}</span>
                  <div className="grow">
                    <div className="digest-item-label">Focus area {item.rank}</div>
                    <h3 className="digest-topic">{item.topic}</h3>
                    <p>{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="digest-empty">
          <div className="digest-empty-title">Your first weekly brief is ready to be created</div>
          <p>Review what the class has been asking about and where students are getting stuck.</p>
        </div>
      )}

      {gen.isPending ? (
        <div className="digest-progress" role="status">
          <span className="digest-progress-dot" aria-hidden="true" />
          <div>
            <strong>Creating your seven-day digest...</strong>
            <p>Refreshing recent conversation summaries and grouping common areas of confusion.</p>
          </div>
        </div>
      ) : (
        <div className="digest-actions">
          <button type="button" className="btn btn-agent" onClick={() => gen.mutate()} disabled={q.isLoading}>
            {run ? 'Refresh 7-day digest' : 'Create 7-day digest'}
          </button>
          {u && Number.isFinite(u.limit) && (
            <span className="muted digest-allowance">
              {Number.isFinite(u.used) ? `${u.used.toLocaleString()} of ` : ''}
              {u.limit.toLocaleString()}-token daily allowance
              {u.resetsAt ? ` · resets ${fmtWhen(u.resetsAt)}` : ''}
            </span>
          )}
        </div>
      )}

      {error && <div className="error">{describeChatError(error)}</div>}
    </Tile>
  );
}
