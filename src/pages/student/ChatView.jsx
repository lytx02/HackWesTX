import { Navigate, useNavigate, useParams } from 'react-router-dom';
import AgentChat from '../../components/AgentChat.jsx';
import { ErrorNote, Loading } from '../../components/Status.jsx';
import { useConversation, useSendMessage } from '../../api/hooks.js';

// AI Helper Chat View: one large conversation. Header = Class Name — Topic.
export default function ChatView() {
  const { classId, chatId } = useParams();
  const navigate = useNavigate();
  const q = useConversation(chatId);
  const send = useSendMessage(chatId, classId);

  if (q.isLoading) return <Loading label="Loading conversation..." />;
  if (q.error?.status === 404) return <Navigate to={`/class/${classId}`} replace />;
  if (q.error) return <ErrorNote error={q.error} retry={q.refetch} />;

  const { conversation: chat, class: cls, messages } = q.data;
  const log = messages.map((m) => ({ who: m.sender, text: m.body, streaming: m.streaming }));

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
          messages={log}
          onSend={(text) => send.mutateAsync(text)}
          greeting={`Hi, I'm ${cls.agentName}. What would you like to work through in ${cls.name}?`}
          placeholder="Type something..."
          autoFocus
        />
      </div>
    </div>
  );
}
