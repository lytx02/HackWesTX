import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Tile from '../../components/Tile.jsx';
import AssignmentFormModal from '../../components/AssignmentFormModal.jsx';
import { useData } from '../../state/DataContext.jsx';
import { fmtDate } from '../../data/week.js';

const initials = (name) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const KIND_LABEL = { alert: 'Struggling', suggestion: 'Suggestion', notice: 'Notice' };

// Instructor Class View: performance, students, AI digest, assignments.
export default function InstructorClassView({ cls }) {
  const navigate = useNavigate();
  const { assignmentsFor, studentsFor, digests, dispatch } = useData();
  const [showCreate, setShowCreate] = useState(false);

  const all = assignmentsFor(cls.id);
  const graded = all.filter((a) => a.avg != null);
  const overall = graded.length ? Math.round(graded.reduce((s, a) => s + a.avg, 0) / graded.length) : null;
  const roster = studentsFor(cls.id).sort((a, b) => b.avg - a.avg);
  const digest = digests[cls.id] ?? [];
  const byDueDesc = [...all].sort((a, b) => b.due.localeCompare(a.due));

  return (
    <>
      <div className="page-head">
        <div>
          <button type="button" className="link-btn" onClick={() => navigate('/dashboard')}>
            ← Your classes
          </button>
          <p className="eyebrow" style={{ marginTop: 8 }}>
            {cls.code} · {cls.term}
          </p>
          <h1>{cls.name}</h1>
          {cls.overview && <p className="muted">{cls.overview}</p>}
        </div>
      </div>

      <div className="tiles">
        <Tile title="Performance" span={8}>
          <div className="stat-row">
            <div className="stat">
              <span className="value">{overall != null ? `${overall}%` : '—'}</span>
              <span className="muted">Class average</span>
            </div>
            <div className="stat">
              <span className="value">{roster.length}</span>
              <span className="muted">Students</span>
            </div>
            <div className="stat">
              <span className="value">{graded.length}/{all.length}</span>
              <span className="muted">Graded</span>
            </div>
          </div>
          <ul className="list">
            {graded.map((a) => (
              <li key={a.id} className="list-item">
                <div className="grow">
                  <div className="title">{a.title}</div>
                  <div className="bar">
                    <span style={{ width: `${a.avg}%` }} />
                  </div>
                </div>
                <span className={`chip ${a.avg < 75 ? 'chip-accent' : ''}`}>{a.avg}% avg</span>
              </li>
            ))}
            {graded.length === 0 && <p className="muted">Nothing graded yet.</p>}
          </ul>
        </Tile>

        <Tile title="Students" span={4}>
          <ul className="list">
            {roster.map((s) => (
              <li key={s.id} className="list-item">
                <span className="avatar">{initials(s.name)}</span>
                <div className="grow">
                  <div className="title">{s.name}</div>
                  <div className="muted">{s.email}</div>
                </div>
                <span className={`chip ${s.avg < 75 ? 'chip-accent' : ''}`}>{s.avg}%</span>
              </li>
            ))}
            {roster.length === 0 && <p className="muted">No students enrolled yet.</p>}
          </ul>
        </Tile>

        <Tile title="AI Digest" span={6} action={<span className="chip chip-agent">✦ agent</span>}>
          {digest.length === 0 ? (
            <p className="muted">No insights yet. The agent will post here once there is activity.</p>
          ) : (
            <ul className="digest">
              {digest.map((d, i) => (
                <li key={i} className={`digest-item ${d.kind}`}>
                  <span className={`chip ${d.kind === 'alert' ? 'chip-accent' : d.kind === 'suggestion' ? 'chip-agent' : ''}`}>
                    {KIND_LABEL[d.kind]}
                  </span>
                  <p>{d.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Tile>

        <Tile title="Assignments" span={6}>
          <div className="stack">
            <button type="button" className="box row-box new-chat" onClick={() => setShowCreate(true)}>
              <span className="plus">+</span>
              <span className="title">Create new assignment</span>
            </button>
            {byDueDesc.map((a) => (
              <div key={a.id} className="box row-box static">
                <div className="grow">
                  <div className="title">{a.title}</div>
                  <div className="muted">due {fmtDate(a.due)}{a.details ? ` · ${a.details}` : ''}</div>
                </div>
                <span className={`chip ${a.avg == null ? '' : a.avg < 75 ? 'chip-accent' : ''}`}>
                  {a.avg == null ? 'not graded' : `${a.avg}% avg`}
                </span>
              </div>
            ))}
          </div>
        </Tile>
      </div>

      {showCreate && (
        <AssignmentFormModal
          onClose={() => setShowCreate(false)}
          onSubmit={(assignment) => dispatch({ type: 'ADD_ASSIGNMENT', assignment: { ...assignment, classId: cls.id } })}
        />
      )}
    </>
  );
}
