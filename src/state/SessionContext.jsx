import { createContext, useContext, useMemo, useState } from 'react';
import { institutions } from '../data/mock.js';

const SessionContext = createContext(null);
const STORAGE_KEY = 'campus-ai.session';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }) {
  const [session, setSession] = useState(load);
  const [pendingRole, setPendingRole] = useState(null); // chosen on landing, before auth

  const value = useMemo(
    () => ({
      session, // { role, email, institutionId } or null
      pendingRole,
      setPendingRole,
      signIn: ({ role, email, institutionId }) => {
        const next = { role, email, institutionId, signedInAt: Date.now() };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setSession(next);
      },
      signOut: () => {
        localStorage.removeItem(STORAGE_KEY);
        setSession(null);
      },
      institution: institutions.find((i) => i.id === session?.institutionId) ?? null,
    }),
    [session, pendingRole]
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
