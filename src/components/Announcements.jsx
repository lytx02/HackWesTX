import Tile from './Tile.jsx';
import { fmtDate } from '../data/week.js';

// Announcements tile: institution notices + assistant reminders. Sits on top of both dashboards.
export default function Announcements({ items = [] }) {
  return (
    <Tile title="Announcements" span={12} className="tile-compact">
      {items.length === 0 ? (
        <p className="muted">No announcements.</p>
      ) : (
        <ul className="list">
          {items.map((n) => (
            <li key={n.id} className={`list-item announce ${n.source}`}>
              <div className="grow">
                <div className="title">{n.title}</div>
                <div className="muted">{n.body}</div>
              </div>
              <span className={`chip ${n.source === 'agent' ? 'chip-agent' : 'chip-accent'}`}>
                {n.source === 'agent' ? 'Assistant' : 'Institution'} · {fmtDate(n.publishedOn)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}
