import { createContext, useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setToken } from '../api/client.js';

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

export function SessionProvider({ children }) {
  const [session, setSession] = useState(load); // { user, institution } or null
  const [pendingRole, setPendingRole] = useState(null); // chosen on landing, before auth
  const qc = useQueryClient();

  const value = useMemo(
    () => ({
      session,
      pendingRole,
      setPendingRole,
      // Temporary email + role login against the API. Auth0 replaces this call later.
      signIn: async ({ role, email, name }) => {
        const data = await api.post('/auth/login', { role, email, name });
        setToken(data.token);
        const next = { user: data.user, institution: data.institution, signedInAt: Date.now() };
        persist(next);
        setSession(next);
        return next;
      },
      signOut: async () => {
        try {
          await api.post('/auth/logout');
        } catch {
          /* token may already be invalid */
        }
        setToken(null);
        persist(null);
        qc.clear();
        setSession(null);
      },
      institution: session?.institution ?? null,
    }),
    [session, pendingRole, qc]
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
