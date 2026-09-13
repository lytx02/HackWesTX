import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession, validateAcademicEmail } from '../state/SessionContext.jsx';

// Returning-user login. POC: any academic email + any password signs you in
// with the chosen role through the API. Auth0 replaces this screen later.
export default function Login() {
  const navigate = useNavigate();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('student');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const err = validateAcademicEmail(email, null);
    if (err) return setError(err);
    if (!password) return setError('Enter your password.');
    setBusy(true);
    setError(null);
    try {
      await signIn({ role, email: email.trim().toLowerCase() });
      navigate('/dashboard', { replace: true });
    } catch (e2) {
      setError(e2.message);
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <form className="card auth-card fade-in" onSubmit={submit}>
        <div>
          <p className="eyebrow">Welcome back</p>
          <h1 style={{ fontSize: '2rem', marginTop: 8 }}>Log in</h1>
        </div>

        <div className="field">
          <label htmlFor="email">Institution email</label>
          <input
            id="email"
            className="input"
            type="email"
            placeholder="you@school.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            className="input"
            type="password"
            placeholder="Password..."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <div className="field">
          <label>Log in as</label>
          <div className="row">
            {['student', 'instructor'].map((r) => (
              <button
                key={r}
                type="button"
                className="btn btn-sm"
                aria-pressed={role === r}
                onClick={() => setRole(r)}
                style={role === r ? { background: 'var(--color-primary)', color: 'var(--color-primaryText)', borderColor: 'var(--color-primary)' } : undefined}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="row between">
          <span className="muted">
            New here?{' '}
            <button type="button" className="link-btn" onClick={() => navigate('/')}>
              Get started
            </button>
          </span>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Signing in...' : 'Log in'}
          </button>
        </div>
      </form>
    </div>
  );
}
