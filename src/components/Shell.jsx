import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext.jsx';
import { useTheme } from '../theme/ThemeProvider.jsx';
import { useMe } from '../api/hooks.js';
import AgentBubble from './AgentBubble.jsx';
import { CoursePanel, IconRail, SidebarToggle, useSidebarMode } from './Sidebar.jsx';

const NO_CLASSES = [];

// App frame: sidebar (icon rail or expanded course panel) + page outlet + helper agent.
export default function Shell() {
  const { signOut } = useSession();
  const { name, setTheme, available } = useTheme();
  const navigate = useNavigate();
  const me = useMe();
  const { mode, toggle } = useSidebarMode();

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
  const signOutAndLeave = () => signOut().then(() => navigate('/'));
  const classes = me.data?.classes ?? NO_CLASSES;

  return (
    <div className="shell" data-sidebar={mode}>
      <aside className="sidebar">
        <SidebarToggle mode={mode} onToggle={toggle} />
        {mode === 'expanded' ? (
          <CoursePanel classes={classes} themeName={name} onCycleTheme={cycleTheme} onSignOut={signOutAndLeave} />
        ) : (
          <IconRail classes={classes} themeName={name} onCycleTheme={cycleTheme} onSignOut={signOutAndLeave} />
        )}
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <AgentBubble />
    </div>
  );
}
