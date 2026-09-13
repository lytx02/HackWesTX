import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setToken, setTokenProvider } from '../api/client.js';
import { authMode } from '../auth/config.js';

const SessionContext = createContext(null);
const STORAGE_KEY = 'campus-ai.session';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? null;
  } catch {
    return null;
  }
}

function persist(session) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

// `auth0` is the useAuth0() object when Auth0 is configured, else null.
export function SessionProvider({ children, auth0 }) {
  const [session, setSession] = useState(load); // { user, institution } or null
  const [pendingRole, setPendingRole] = useState(null); // chosen on landing, before auth
  const qc = useQueryClient();

  // API calls use Auth0 access tokens when signed in through Auth0.
  useEffect(() => {
    if (auth0?.isAuthenticated) setTokenProvider(() => auth0.getAccessTokenSilently());
    else setTokenProvider(null);
  }, [auth0?.isAuthenticated, auth0?.getAccessTokenSilently]);

  // Auth0 says we are signed out (SDK finished loading, no user): drop any stale session.
  useEffect(() => {
    if (auth0 && !auth0.isLoading && !auth0.isAuthenticated && session) {
      persist(null);
      setSession(null);
    }
  }, [auth0?.isLoading, auth0?.isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const adopt = useCallback((data) => {
    const next = { user: data.user, institution: data.institution, signedInAt: Date.now() };
    persist(next);
    setSession(next);
    return next;
  }, []);

  const value = useMemo(
    () => ({
      mode: authMode,
      session,
      pendingRole,
      setPendingRole,
      institution: session?.institution ?? null,
      auth0Loading: Boolean(auth0?.isLoading),

      // Auth0: send the browser to Universal Login. `role` rides along in
      // appState and comes back on /callback for first-time registration.
      signInWithAuth0: ({ role = null, signup = false } = {}) =>
        auth0.loginWithRedirect({
          appState: { role },
          authorizationParams: signup ? { screen_hint: 'signup' } : {},
        }),

      // Auth0: after the redirect, create or fetch our user row.
      completeAuth0: async ({ role }) => adopt(await api.post('/auth/register', role ? { role } : {})),

      // Legacy email + role login (demo accounts, local dev).
      signIn: async ({ role, email, name }) => {
        const data = await api.post('/auth/login', { role, email, name });
        setToken(data.token);
        return adopt(data);
      },

      signOut: async () => {
        try {
          await api.post('/auth/logout');
        } catch {
          /* token may already be invalid */
        }
        setToken(null);
        setTokenProvider(null);
        persist(null);
        qc.clear();
        setSession(null);
        if (auth0?.isAuthenticated) {
          await auth0.logout({ logoutParams: { returnTo: window.location.origin } });
        }
      },
    }),
    [session, pendingRole, qc, auth0, adopt]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

// ".edu or equivalent": .edu, .ac.xx, .edu.xx, or a domain the institution lists.
export function validateAcademicEmail(email, institution) {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(email.trim().toLowerCase());
  if (!m) return 'Enter a valid email address.';
  const domain = m[1];
  const isAcademic = /(\.|^)edu$|\.edu\.[a-z]{2}$|\.ac\.[a-z]{2}$/.test(domain);
  const matchesInstitution = institution?.domains.some((d) => domain === d || domain.endsWith(`.${d}`));
  if (matchesInstitution) return null;
  if (!isAcademic) return 'Use your institution (.edu or equivalent) email.';
  if (institution) return `That email does not belong to ${institution.name} (${institution.domains.join(', ')}).`;
  return null;
}
