import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { institutions } from '../data/mock.js';
import { useSession, validateAcademicEmail } from '../state/SessionContext.jsx';

export default function InstitutionAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pendingRole, signIn } = useSession();
  const role = location.state?.role ?? pendingRole;

  const [institutionId, setInstitutionId] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('form'); // form -> sent -> done

  const institution = institutions.find((i) => i.id === institutionId);

  if (!role) {
    // Landed here without choosing a role; send them back to the questionnaire.
    navigate('/', { replace: true });
    return null;
  }

  const submit = (e) => {
    e.preventDefault();
    if (!institution) return setError('Choose your institution.');
    const err = validateAcademicEmail(email, institution);
    if (err) return setError(err);
    setError(null);
    setStep('sent'); // POC: pretend a magic link / code was sent
  };

  // POC: "clicking the link" registers or signs in through the API.
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn({ role, email: email.trim().toLowerCase() });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="centered">
      <form className="card auth-card fade-in" onSubmit={submit}>
        <div>
          <p className="eyebrow">Step 2 of 2 · {role}</p>
          <h1 style={{ fontSize: '2rem', marginTop: 8 }}>Choose your institution</h1>
          <p className="muted">Then verify with your institution email.</p>
        </div>

        {step === 'form' ? (
          <>
            <div className="field">
              <label htmlFor="inst">Institution</label>
              <select
                id="inst"
                className="input"
                value={institutionId}
                onChange={(e) => {
                  setInstitutionId(e.target.value);
                  setError(null);
                }}
              >
                <option value="">Choose school...</option>
                {institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="email">Institution email</label>
              <input
                id="email"
                className="input"
                type="email"
                placeholder={institution ? `someone@${institution.domains[0]}` : 'someone@school.edu'}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                autoComplete="email"
              />
            </div>

            {error && <p className="error">{error}</p>}

            <div className="row between">
              <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>
                Back
              </button>
              <button type="submit" className="btn btn-primary">
                Send verification
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="stack">
              <p>
                We sent a verification link to <strong>{email}</strong>.
              </p>
              <p className="muted">POC mode: there is no real email yet. Click below to simulate opening the link.</p>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="row between">
              <button type="button" className="btn btn-ghost" onClick={() => setStep('form')} disabled={busy}>
                Use a different email
              </button>
              <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>
                {busy ? 'Signing in...' : 'I clicked the link'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
