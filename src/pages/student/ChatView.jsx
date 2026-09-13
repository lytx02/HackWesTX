import { Navigate, useNavigate, useParams } from 'react-router-dom';
import AgentChat from '../../components/AgentChat.jsx';
import { useData } from '../../state/DataContext.jsx';

const DEFAULT_TITLE = 'New conversation';

// AI Helper Chat View: one large conversation. Header = Class Name — Topic.
export default function ChatView() {
  const { classId, chatId } = useParams();
  const navigate = useNavigate();
  const { classById, chats, assignmentsFor, dispatch } = useData();

  const cls = classById(classId);
  const chat = chats.find((c) => c.id === chatId && c.classId === classId);
  if (!cls || !chat) return <Navigate to={cls ? `/class/${cls.id}` : '/dashboard'} replace />;

  const upcoming = assignmentsFor(cls.id).filter((a) => !a.done);

  const append = (message) => {
    dispatch({ type: 'ADD_MESSAGE', chatId: chat.id, message });
    // First user message names an untitled conversation.
    if (chat.title === DEFAULT_TITLE && message.who === 'user') {
      dispatch({ type: 'RENAME_CHAT', chatId: chat.id, title: message.text.slice(0, 60) });
    }
  };

  return (
    <div className="chat-page">
      <div className="page-head">
        <div>
          <button type="button" className="link-btn" onClick={() => navigate(`/class/${cls.id}`)}>
            ← {cls.name}
          </button>
          <h1 style={{ marginTop: 8 }}>
            {cls.name} <span className="muted" style={{ fontSize: '1.2rem' }}>—</span> {chat.title}
          </h1>
        </div>
        <span className="chip chip-agent">✦ {cls.agentName}</span>
      </div>

      <div className="card chat-card">
        <AgentChat
          scope="class"
          context={{ cls, upcoming }}
          messages={chat.messages}
          onAppend={append}
          greeting={`Hi, I'm ${cls.agentName}. What would you like to work through in ${cls.name}?`}
          placeholder="Type something..."
          autoFocus
        />
      </div>
    </div>
  );
}
