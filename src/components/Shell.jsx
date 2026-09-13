import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';
import { useData } from '../state/DataContext.jsx';
import { useTheme } from '../theme/ThemeProvider.jsx';
import AgentBubble from './AgentBubble.jsx';

// App frame: icon sidebar (Home, each class, theme, sign out) + page outlet + helper agent.
export default function Shell() {
  const { session, signOut } = useSession();
  const { classesFor } = useData();
  const { name, setTheme, available } = useTheme();
  const navigate = useNavigate();

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
        {classesFor(session.role).map((c) => (
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
          onClick={() => {
            signOut();
            navigate('/');
          }}
          title="Sign out"
        >
          ⏻
        </button>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      {/* Instructors get the general helper too; students additionally have per-class chats. */}
      <AgentBubble />
    </div>
  );
}
