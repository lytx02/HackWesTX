import { useState } from 'react';
import Tile from '../../components/Tile.jsx';
import Announcements from '../../components/Announcements.jsx';
import ClassFormModal from '../../components/ClassFormModal.jsx';
import { AddBox, ClassCard } from '../../components/ClassCard.jsx';
import { useData } from '../../state/DataContext.jsx';
import { useSession } from '../../state/SessionContext.jsx';

// Instructor dashboard: classes as tiles + Add Class popup.
export default function InstructorDashboard() {
  const { session, institution } = useSession();
  const { classesFor, studentsFor, dispatch } = useData();
  const [showCreate, setShowCreate] = useState(false);

  const teaching = classesFor('instructor');

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{institution?.name ?? 'Campus AI'}</p>
          <h1>Your classes</h1>
        </div>
        <span className="muted">
          {session.email} · <span className="chip">{session.role}</span>
        </span>
      </div>

      <div className="tiles">
        <Announcements />

        <Tile
          title="Classes"
          span={12}
          action={
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>
              + Add class
            </button>
          }
        >
          <div className="box-grid">
            {teaching.map((c) => (
              <ClassCard key={c.id} cls={c} subtitle={`${studentsFor(c.id).length} students · ${c.term}`} />
            ))}
            <AddBox label="Add class" onClick={() => setShowCreate(true)} />
          </div>
        </Tile>
      </div>

      {showCreate && (
        <ClassFormModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSubmit={({ name, code, overview }) =>
            dispatch({ type: 'ADD_CLASS', role: 'instructor', name, code, overview, instructor: session.email })
          }
        />
      )}
    </>
  );
}
