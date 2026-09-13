import { useState } from 'react';
import { useData } from '../state/DataContext.jsx';
import { useSession } from '../state/SessionContext.jsx';
import { upcomingWeek } from '../data/week.js';
import AgentChat from './AgentChat.jsx';

// The "one big" helper agent: floating bubble available on every page.
// Per-class "small" agents live in the class chat views.
export default function AgentBubble() {
  const [open, setOpen] = useState(false);
  const { session } = useSession();
  const { assignments, classesFor } = useData();
  const ids = new Set(classesFor(session.role).map((c) => c.id));
  const { items, label } = upcomingWeek(assignments.filter((a) => ids.has(a.classId)));

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
            context={{ upcoming: items, label }}
            greeting={
              session.role === 'instructor'
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
