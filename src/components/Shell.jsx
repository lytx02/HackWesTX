import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';
import { useTheme } from '../theme/ThemeProvider.jsx';
import { useMe } from '../api/hooks.js';
import AgentBubble from './AgentBubble.jsx';

// App frame: icon sidebar (Home, each class, theme, sign out) + page outlet + helper agent.
export default function Shell() {
  const { signOut } = useSession();
  const { name, setTheme, available } = useTheme();
  const navigate = useNavigate();
  const me = useMe();

  // 401 with a valid Auth0 token but no user row: finish registration.
  // Any other 401 (expired/revoked): drop the session and go back to the landing page.
  useEffect(() => {
    if (me.error?.status !== 401) return;
    if (me.error.code === 'not_registered') navigate('/callback', { replace: true });
    else signOut().then(() => navigate('/', { replace: true }));
  }, [me.error, signOut, navigate]);

  const cycleTheme = () => {
    const i = available.indexOf(name);
    setTheme(available[(i + 1) % available.length]);
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand" title="Campus AI">C</div>
        <NavLink to="/dashboard" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`} title="Home">
          ⌂
        </NavLink>
        {(me.data?.classes ?? []).map((c) => (
          <NavLink
            key={c.id}
            to={`/class/${c.id}`}
            className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}
            title={c.name}
          >
            <span className="swatch" style={{ background: c.color, margin: 0 }} />
          </NavLink>
        ))}
        <div className="spacer" />
        <button type="button" className="nav-btn" onClick={cycleTheme} title={`Theme: ${name}`}>
          ◐
        </button>
        <button
          type="button"
          className="nav-btn"
          onClick={() => signOut().then(() => navigate('/'))}
          title="Sign out"
        >
          ⏻
        </button>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <AgentBubble />
    </div>
  );
}
