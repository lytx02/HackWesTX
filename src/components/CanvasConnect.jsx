import { useState } from 'react';
import Tile from './Tile.jsx';
import { useConnectCanvas, useDisconnectCanvas, useSyncCanvas } from '../api/hooks.js';
import { institutions } from '../data/mock.js';

// "Connect Canvas" card. Not connected: a short guide + URL/token form.
// Connected: who you are on Canvas, last sync, Sync now, Disconnect.
export default function CanvasConnect({ canvas, institutionId }) {
  const connect = useConnectCanvas();
  const sync = useSyncCanvas();
  const disconnect = useDisconnectCanvas();
  const suggested = institutions.find((i) => i.id === institutionId)?.canvasUrl ?? '';
  const [baseUrl, setBaseUrl] = useState(suggested);
  const [token, setToken] = useState('');
  const [open, setOpen] = useState(false);

  if (!canvas?.configured) return null;

  const busy = connect.isPending || sync.isPending || disconnect.isPending;
  // The latest completed action's summary, if any (each mutate clears its own data/error).
  const summary = sync.data ?? connect.data ?? null;
  const error = connect.error ?? sync.error ?? disconnect.error ?? null;

  const submit = (e) => {
    e.preventDefault();
    sync.reset();
    disconnect.reset();
    connect.mutate({ baseUrl, token }, { onSuccess: () => setToken('') });
  };

  const cancel = () => {
    connect.reset();
    setToken('');
    setOpen(false);
  };

  if (canvas.connected) {
    const last = canvas.lastSyncAt ? new Date(canvas.lastSyncAt).toLocaleString() : 'never';
    return (
      <Tile title="Canvas" span={12} className="tile-compact" action={<span className="chip chip-agent">✓ connected</span>}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <span className="muted" aria-live="polite">
            Signed in to Canvas as <strong>{canvas.canvasName}</strong> at {canvas.host ?? canvas.baseUrl}. Last sync {last}.
            {summary && ` Imported ${summary.courses} courses, ${summary.assignments} assignments.`}
            {error && (
              <span className="error" role="alert">
                {' '}
                {error.message}
              </span>
            )}
          </span>
          <span className="row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => {
                connect.reset();
                disconnect.reset();
                sync.mutate();
              }}
            >
              {sync.isPending ? 'Syncing...' : 'Sync now'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => {
                sync.reset();
                disconnect.mutate();
              }}
            >
              {disconnect.isPending ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </span>
        </div>
      </Tile>
    );
  }

  return (
    <Tile
      title="Bring in your Canvas classes"
      span={12}
      className="tile-compact"
      action={
        !open && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
            Connect Canvas
          </button>
        )
      }
    >
      {!open ? (
        <p className="muted">
          Import your courses, assignments, and due dates from your school's Canvas. Takes about a minute and only needs a
          token you generate yourself.
        </p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <ol className="muted steps">
            <li>
              Open your school's Canvas and go to <strong>Account → Settings</strong>.
            </li>
            <li>
              Scroll to <strong>Approved Integrations</strong> and click <strong>+ New Access Token</strong>. Any purpose, no expiry needed.
            </li>
            <li>Copy the token Canvas shows once and paste it below. We store it encrypted and never show it again.</li>
          </ol>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 260px' }}>
              <label htmlFor="canvas-url">Canvas URL</label>
              <input id="canvas-url" className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://yourschool.instructure.com" autoComplete="off" />
            </div>
            <div className="field" style={{ flex: '2 1 320px' }}>
              <label htmlFor="canvas-token">Access token</label>
              <input id="canvas-token" className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the token from Canvas" autoComplete="off" />
            </div>
          </div>
          {connect.error && (
            <p className="error" role="alert">
              {connect.error.message}
            </p>
          )}
          <div className="row between">
            <button type="button" className="btn btn-ghost" onClick={cancel} disabled={connect.isPending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={connect.isPending || !token.trim() || !baseUrl.trim()}>
              {connect.isPending ? 'Checking with Canvas...' : 'Connect and import'}
            </button>
          </div>
        </form>
      )}
    </Tile>
  );
}
