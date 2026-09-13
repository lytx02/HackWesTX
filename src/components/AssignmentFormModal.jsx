import { useState } from 'react';
import Modal from './Modal.jsx';

export default function AssignmentFormModal({ onSubmit, onClose }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return setError('Title is required.');
    if (!due) return setError('Due date is required.');
    onSubmit({ title: title.trim(), due, details: details.trim() });
    onClose();
  };

  return (
    <Modal title="Create new assignment" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="as-title">Title</label>
          <input id="as-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Programming Project 2" autoFocus />
        </div>
        <div className="field">
          <label htmlFor="as-due">Due date</label>
          <input id="as-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="as-details">Details</label>
          <textarea id="as-details" className="input" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What students need to do." />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row between">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Create assignment
          </button>
        </div>
      </form>
    </Modal>
  );
}
