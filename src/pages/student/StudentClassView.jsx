import { useNavigate } from 'react-router-dom';
import Tile from '../../components/Tile.jsx';
import { useData } from '../../state/DataContext.jsx';
import { fmtDate } from '../../data/week.js';

// Student Class Home: AI Helper conversation selector + upcoming assignments.
export default function StudentClassView({ cls }) {
  const navigate = useNavigate();
  const { assignmentsFor, chatsFor, addChat } = useData();

  const upcoming = assignmentsFor(cls.id)
    .filter((a) => !a.done)
    .sort((a, b) => a.due.localeCompare(b.due));
  const chats = chatsFor(cls.id);

  const newChat = () => {
    const id = addChat(cls.id);
    navigate(`/class/${cls.id}/chat/${id}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <button type="button" className="link-btn" onClick={() => navigate('/dashboard')}>
            ← Dashboard
          </button>
          <p className="eyebrow" style={{ marginTop: 8 }}>
            {cls.code} · {cls.term}
          </p>
          <h1>{cls.name}</h1>
          <p className="muted">{cls.instructor}</p>
        </div>
      </div>

      <div className="tiles">
        <Tile
          title="AI Helper"
          span={8}
          action={
            <span className="chip chip-agent">
              ✦ {cls.agentName}
            </span>
          }
        >
          <p className="muted">{cls.agentBlurb}</p>
          <div className="stack">
            <button type="button" className="box row-box new-chat" onClick={newChat}>
              <span className="plus">+</span>
              <span className="title">New chat</span>
            </button>
            {chats.map((c) => (
              <button
                key={c.id}
                type="button"
                className="box row-box"
                onClick={() => navigate(`/class/${cls.id}/chat/${c.id}`)}
              >
                <div className="grow">
                  <div className="title">{c.title}</div>
                  <div className="muted">
                    {c.messages.length ? c.messages[c.messages.length - 1].text.slice(0, 90) : 'No messages yet'}
                  </div>
                </div>
                <span className="chip">{c.messages.length} msgs</span>
              </button>
            ))}
            {chats.length === 0 && <p className="muted">No conversations yet. Start one above.</p>}
          </div>
        </Tile>

        <Tile title="Upcoming" span={4}>
          {upcoming.length === 0 ? (
            <p className="muted">Nothing pending.</p>
          ) : (
            <ul className="list">
              {upcoming.map((a) => (
                <li key={a.id} className="list-item">
                  <div className="grow">
                    <div className="title">{a.title}</div>
                    <div className="muted">due {fmtDate(a.due)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Tile>
      </div>
    </>
  );
}
