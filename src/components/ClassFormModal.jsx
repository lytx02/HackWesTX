import { useState } from 'react';
import Modal from './Modal.jsx';

// mode 'create' (instructor): Class Name, Course Number, Class Overview.
// mode 'join' (student):      Class Name, Course Number.
export default function ClassFormModal({ mode = 'create', onSubmit, onClose }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [overview, setOverview] = useState('');
  const [error, setError] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Class name is required.');
    if (!code.trim()) return setError('Course number is required.');
    onSubmit({ name: name.trim(), code: code.trim(), overview: overview.trim() });
    onClose();
  };

  return (
    <Modal title={mode === 'create' ? 'Add class' : 'Join a class'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="cls-name">Class name</label>
          <input id="cls-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer Networks" autoFocus />
        </div>
        <div className="field">
          <label htmlFor="cls-code">Course number</label>
          <input id="cls-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CS 4283" />
        </div>
        {mode === 'create' && (
          <div className="field">
            <label htmlFor="cls-overview">Class overview</label>
            <textarea
              id="cls-overview"
              className="input"
              rows={4}
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              placeholder="What the course covers, in a sentence or two."
            />
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row between">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {mode === 'create' ? 'Create class' : 'Join class'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
