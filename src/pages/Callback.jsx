import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';

// Auth0 lands here after Universal Login. Registers the user on the API (first
// login) or fetches the existing row, then continues to the dashboard.
export default function Callback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, session, auth0Loading, completeAuth0, signOut } = useSession();
  const [error, setError] = useState(null);
  const [role, setRole] = useState(location.state?.role ?? null);
  const [needsRole, setNeedsRole] = useState(false);

  useEffect(() => {
    if (mode !== 'auth0') {
      navigate('/', { replace: true });
      return;
    }
    if (session) {
      navigate('/dashboard', { replace: true });
      return;
    }
    if (auth0Loading || needsRole) return;

    let cancelled = false;
    completeAuth0({ role })
      .then(() => !cancelled && navigate('/dashboard', { replace: true }))
      .catch((err) => {
        if (cancelled) return;
        // Signed in with Auth0 but no account yet and no role was chosen (e.g. "Log in" path).
        if (err.code === 'role_required') setNeedsRole(true);
        else setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, session, auth0Loading, role, needsRole]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="centered">
      <div className="card auth-card fade-in">
        <div>
          <p className="eyebrow">Signing you in</p>
          <h1 style={{ fontSize: '2rem', marginTop: 8 }}>{needsRole ? 'One more thing' : 'Just a moment'}</h1>
        </div>

        {needsRole && !error && (
          <>
            <p className="muted">This is your first sign-in. What are you?</p>
            <div className="choice-grid">
              {['student', 'instructor'].map((r) => (
                <button
                  key={r}
                  type="button"
                  className="choice"
                  onClick={() => {
                    setRole(r);
                    setNeedsRole(false);
                  }}
                >
                  <span className="dot" />
                  <h3 style={{ textTransform: 'capitalize' }}>{r}</h3>
                </button>
              ))}
            </div>
          </>
        )}

        {error ? (
          <>
            <p className="error">{error}</p>
            <div className="row between">
              <button type="button" className="btn btn-ghost" onClick={() => signOut()}>
                Sign out
              </button>
              <button type="button" className="btn btn-primary" onClick={() => navigate('/', { replace: true })}>
                Back to start
              </button>
            </div>
          </>
        ) : (
          !needsRole && <p className="muted">Setting up your account...</p>
        )}
      </div>
    </div>
  );
}
