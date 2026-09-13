import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Tile from '../../components/Tile.jsx';
import Announcements from '../../components/Announcements.jsx';
import ClassFormModal from '../../components/ClassFormModal.jsx';
import { AddBox, ClassCard } from '../../components/ClassCard.jsx';
import { useCreateClass, useCreateConversation, useToggleDone } from '../../api/hooks.js';
import { fmtDate, upcomingWeek } from '../../data/week.js';

export default function StudentDashboard({ me }) {
  const navigate = useNavigate();
  const [showJoin, setShowJoin] = useState(false);
  const joinClass = useCreateClass();
  const toggleDone = useToggleDone();
  const newChat = useCreateConversation();

  const { user, institution, classes, assignments, announcements } = me;
  const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
  const { label, items } = upcomingWeek(assignments);

  // "AI help" on a task opens a new class chat seeded with that task as the topic.
  const helpWith = async (a) => {
    const conv = await newChat.mutateAsync({ classId: a.classId, title: a.title });
    navigate(`/class/${a.classId}/chat/${conv.id}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{institution?.name ?? 'Campus AI'}</p>
          <h1>Dashboard</h1>
        </div>
        <span className="muted">
          {user.email} · <span className="chip">{user.role}</span>
        </span>
      </div>

      <div className="tiles">
        <Announcements items={announcements} />

        <Tile
          title="Classes"
          span={8}
          action={
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowJoin(true)}>
              + Add class
            </button>
          }
        >
          <div className="box-grid">
            {classes.map((c) => (
              <ClassCard key={c.id} cls={c} />
            ))}
            <AddBox label="Add class" onClick={() => setShowJoin(true)} />
          </div>
        </Tile>

        <Tile title="Upcoming assignments" span={4} action={<span className="chip">{label}</span>}>
          {items.length === 0 ? (
            <p className="muted">Nothing due. You are caught up.</p>
          ) : (
            <ul className="list">
              {items.map((a) => (
                <li key={a.id} className={`list-item ${a.done ? 'done' : ''}`}>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={a.done}
                    disabled={toggleDone.isPending}
                    onChange={() => toggleDone.mutate({ id: a.id, done: !a.done })}
                    aria-label={`Mark ${a.title} done`}
                  />
                  <div className="grow">
                    <div className="title">{a.title}</div>
                    <div className="muted">
                      <span className="swatch" style={{ background: classById[a.classId]?.color }} />
                      {classById[a.classId]?.code} · due {fmtDate(a.dueDate)}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm btn-agent" disabled={newChat.isPending} onClick={() => helpWith(a)}>
                    AI help
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Tile>
      </div>

      {showJoin && (
        <ClassFormModal mode="join" onClose={() => setShowJoin(false)} onSubmit={({ name, code }) => joinClass.mutateAsync({ name, code })} />
      )}
    </>
  );
}
