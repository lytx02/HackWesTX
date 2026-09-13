import { useState } from 'react';
import Tile from '../../components/Tile.jsx';
import Announcements from '../../components/Announcements.jsx';
import CanvasConnect from '../../components/CanvasConnect.jsx';
import ClassFormModal from '../../components/ClassFormModal.jsx';
import { AddBox, ClassCard } from '../../components/ClassCard.jsx';
import { useCreateClass } from '../../api/hooks.js';

// Instructor dashboard: classes as tiles + Add Class popup.
export default function InstructorDashboard({ me }) {
  const [showCreate, setShowCreate] = useState(false);
  const createClass = useCreateClass();
  const { user, institution, classes, announcements } = me;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{institution?.name ?? 'Campus AI'}</p>
          <h1>Your classes</h1>
        </div>
        <span className="muted">
          {user.email} · <span className="chip">{user.role}</span>
        </span>
      </div>

      <div className="tiles">
        <Announcements items={announcements} />
        <CanvasConnect canvas={me.canvas} institutionId={user.institutionId} />

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
            {classes.map((c) => (
              <ClassCard key={c.id} cls={c} subtitle={`${c.studentCount ?? 0} students · ${c.term}`} />
            ))}
            <AddBox label="Add class" onClick={() => setShowCreate(true)} />
          </div>
        </Tile>
      </div>

      {showCreate && (
        <ClassFormModal mode="create" onClose={() => setShowCreate(false)} onSubmit={(body) => createClass.mutateAsync(body)} />
      )}
    </>
  );
}
