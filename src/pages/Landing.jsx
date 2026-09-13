import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';

const ROLES = [
  { id: 'student', title: 'Student', blurb: 'Track classes, deadlines, and get help from a per-class assistant.' },
  { id: 'instructor', title: 'Instructor', blurb: 'Post announcements, manage assignments, and see where students struggle.' },
];

export default function Landing() {
  const [role, setRole] = useState(null);
  const { mode, setPendingRole, signInWithAuth0 } = useSession();
  const navigate = useNavigate();

  // Auth0: role rides along to /callback for first-time registration.
  // Legacy: continue to the institution + email step.
  const next = () => {
    setPendingRole(role);
    if (mode === 'auth0') signInWithAuth0({ role, signup: true });
    else navigate('/auth', { state: { role } });
  };

  const login = () => (mode === 'auth0' ? signInWithAuth0() : navigate('/login'));

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
            <button key={r.id} type="button" className="choice" aria-pressed={role === r.id} onClick={() => setRole(r.id)}>
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
            <button type="button" className="link-btn" onClick={login}>
              Log in
            </button>
          </span>
          <button type="button" className="btn btn-primary" disabled={!role} onClick={next}>
            {mode === 'auth0' ? 'Continue' : 'Next'}
          </button>
        </div>
        {mode === 'legacy' && (
          <p className="muted" style={{ fontSize: '.8rem' }}>
            Demo mode: sign in with a .edu email, no password needed.
          </p>
        )}
      </div>
    </div>
  );
}
