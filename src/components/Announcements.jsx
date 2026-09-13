import Tile from './Tile.jsx';
import { announcements } from '../data/mock.js';
import { fmtDate } from '../data/week.js';

// Announcements tile: institution notices + assistant reminders. Sits on top of both dashboards.
export default function Announcements() {
  return (
    <Tile title="Announcements" span={12} className="tile-compact">
      <ul className="list">
        {announcements.map((n) => (
          <li key={n.id} className={`list-item announce ${n.source}`}>
            <div className="grow">
              <div className="title">{n.title}</div>
              <div className="muted">{n.body}</div>
            </div>
            <span className={`chip ${n.source === 'agent' ? 'chip-agent' : 'chip-accent'}`}>
              {n.source === 'agent' ? 'Assistant' : 'Institution'} · {fmtDate(n.date)}
            </span>
          </li>
        ))}
      </ul>
    </Tile>
  );
}
