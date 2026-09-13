import Tile from './Tile.jsx';
import { describeChatError } from './AgentChat.jsx';
import { useDigest, useGenerateDigest, useUsage } from '../api/hooks.js';
import { parseISO } from '../data/week.js';

const KIND_LABEL = { alert: 'Struggling', suggestion: 'Suggestion', notice: 'Notice' };

// Server dates are YYYY-MM-DD; render in the viewer's locale.
const fmtDay = (iso) => parseISO(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

// Instants (createdAt, resetsAt) arrive as ISO strings; never recompute the reset.
const fmtWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

// Instructor-only tile over GET /classes/:id/digest. The last successful run
// stays on screen while a generation is pending or has failed.
export default function DigestTile({ classId, span = 6 }) {
  const q = useDigest(classId);
  const gen = useGenerateDigest(classId);
  const usage = useUsage(Boolean(classId));

  const run = q.data?.run ?? null;
  const items = Array.isArray(q.data?.items) ? q.data.items : [];
  const error = gen.error ?? (q.isError ? q.error : null);
  const u = usage.data;

  return (
    <Tile title="AI Digest" span={span} action={<span className="chip chip-agent">✦ agent</span>}>
      {q.isLoading ? (
        <p className="muted digest-state">Loading digest...</p>
      ) : run ? (
        <>
          <div className="digest-meta">
            <span className="muted">
              {fmtDay(run.windowStartDay)} – {fmtDay(run.windowEndDay)}
            </span>
            <span className="muted">
              {run.summaryCount} {run.summaryCount === 1 ? 'conversation summary' : 'conversation summaries'} · {run.studentCount}{' '}
              {run.studentCount === 1 ? 'student' : 'students'}
            </span>
            <span className="muted">Generated {fmtWhen(run.createdAt)}</span>
          </div>
          {items.length === 0 ? (
            <p className="muted digest-state">No recurring themes this week.</p>
          ) : (
            <ul className="digest">
              {items.map((item) => (
                <li key={item.id ?? item.rank} className={`digest-item ${item.kind}`}>
                  <span className="digest-rank">{item.rank}</span>
                  <div className="grow">
                    <div className="digest-topic">{item.topic}</div>
                    <p>{item.body}</p>
                  </div>
                  {KIND_LABEL[item.kind] && <span className="chip chip-agent">{KIND_LABEL[item.kind]}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="muted digest-state">No digest yet. Generate one to see what this week's conversations struggled with.</p>
      )}

      {gen.isPending ? (
        <p className="muted digest-state">Summarizing this week's conversations...</p>
      ) : (
        <div className="digest-actions">
          <button type="button" className="btn btn-agent btn-sm" onClick={() => gen.mutate()} disabled={q.isLoading}>
            {run ? 'Regenerate digest' : 'Generate digest'}
          </button>
          {u && Number.isFinite(u.limit) && (
            <span className="muted">
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
