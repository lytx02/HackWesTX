import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Tile from '../../components/Tile.jsx';
import Announcements from '../../components/Announcements.jsx';
import ClassFormModal from '../../components/ClassFormModal.jsx';
import { AddBox, ClassCard } from '../../components/ClassCard.jsx';
import { useData } from '../../state/DataContext.jsx';
import { useSession } from '../../state/SessionContext.jsx';
import { fmtDate, upcomingWeek } from '../../data/week.js';

export default function StudentDashboard() {
  const navigate = useNavigate();
  const { session, institution } = useSession();
  const { classesFor, assignments, classById, dispatch, addChat } = useData();
  const [showJoin, setShowJoin] = useState(false);

  const myClasses = classesFor('student');
  const myIds = new Set(myClasses.map((c) => c.id));
  const { label, items } = upcomingWeek(assignments.filter((a) => myIds.has(a.classId)));

  // "AI help" on a task opens a new class chat seeded with that task as the topic.
  const helpWith = (a) => {
    const id = addChat(a.classId, a.title);
    navigate(`/class/${a.classId}/chat/${id}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{institution?.name ?? 'Campus AI'}</p>
          <h1>Dashboard</h1>
        </div>
        <span className="muted">
          {session.email} · <span className="chip">{session.role}</span>
        </span>
      </div>

      <div className="tiles">
        <Announcements />

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
            {myClasses.map((c) => (
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
                    onChange={() => dispatch({ type: 'TOGGLE_DONE', id: a.id })}
                    aria-label={`Mark ${a.title} done`}
                  />
                  <div className="grow">
                    <div className="title">{a.title}</div>
                    <div className="muted">
                      <span className="swatch" style={{ background: classById(a.classId)?.color }} />
                      {classById(a.classId)?.code} · due {fmtDate(a.due)}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm btn-agent" onClick={() => helpWith(a)}>
                    AI help
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Tile>
      </div>

      {showJoin && (
        <ClassFormModal
          mode="join"
          onClose={() => setShowJoin(false)}
          onSubmit={({ name, code }) => dispatch({ type: 'JOIN_CLASS', name, code })}
        />
      )}
    </>
  );
}
