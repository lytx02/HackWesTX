import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';

const ROLES = [
  { id: 'student', title: 'Student', blurb: 'Track classes, deadlines, and get help from a per-class assistant.' },
  { id: 'instructor', title: 'Instructor', blurb: 'Post announcements, manage assignments, and see where students struggle.' },
];

export default function Landing() {
  const [role, setRole] = useState(null);
  const { setPendingRole } = useSession();
  const navigate = useNavigate();

  const next = () => {
    setPendingRole(role);
    navigate('/auth', { state: { role } });
  };

  return (
    <div className="centered">
      <div className="card auth-card fade-in">
        <div>
          <p className="eyebrow">Welcome to Campus AI</p>
          <h1 style={{ fontSize: '2rem', marginTop: 8 }}>What are you?</h1>
          <p className="muted">Pick one so we can set up the right workspace.</p>
        </div>

        <div className="choice-grid" role="radiogroup" aria-label="Role">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              className="choice"
              aria-pressed={role === r.id}
              onClick={() => setRole(r.id)}
            >
              <span className="dot" />
              <span>
                <h3>{r.title}</h3>
                <span className="muted">{r.blurb}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="row between">
          <span className="muted">
            Returning?{' '}
            <button type="button" className="link-btn" onClick={() => navigate('/login')}>
              Log in
            </button>
          </span>
          <button type="button" className="btn btn-primary" disabled={!role} onClick={next}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
