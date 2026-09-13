import { useState } from 'react';
import { useSession } from '../state/SessionContext.jsx';
import { useMe } from '../api/hooks.js';
import { upcomingWeek } from '../data/week.js';
import AgentChat from './AgentChat.jsx';

// The "one big" helper agent: floating bubble available on every page. It still
// uses the client-side stub; per-class chats go through the API.
export default function AgentBubble() {
  const [open, setOpen] = useState(false);
  const { session } = useSession();
  const me = useMe();
  const { items, label } = upcomingWeek(me.data?.assignments ?? []);
  const upcoming = items.map((a) => ({ title: a.title, due: a.dueDate }));

  return (
    <>
      {open && (
        <div className="card agent-panel fade-in">
          <header>
            <h3>Helper Agent</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              Close
            </button>
          </header>
          <AgentChat
            scope="general"
            context={{ upcoming, label }}
            greeting={
              session?.user?.role === 'instructor'
                ? 'Hi. Ask me what is due across your classes, or which class needs attention.'
                : "Hi. Ask me what's due this week, or which class assistant to talk to."
            }
          />
        </div>
      )}
      <button
        type="button"
        className="agent-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close helper agent' : 'Open helper agent'}
        title="Helper Agent"
      >
        {open ? '×' : '✦'}
      </button>
    </>
  );
}
