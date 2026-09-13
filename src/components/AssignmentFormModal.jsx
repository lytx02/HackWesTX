import { useState } from 'react';
import Modal from './Modal.jsx';

// `onSubmit` may be async; the modal stays open and shows the error if it throws.
export default function AssignmentFormModal({ onSubmit, onClose }) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return setError('Title is required.');
    if (!dueDate) return setError('Due date is required.');
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ title: title.trim(), dueDate, details: details.trim() });
      onClose();
    } catch (err) {
      setError(err.message ?? 'Could not save the assignment.');
    } finally {
      setBusy(false);
    }
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
          <input id="as-due" className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : 'Create assignment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
