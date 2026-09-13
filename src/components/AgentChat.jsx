import { useEffect, useRef, useState } from 'react';
import { ask } from '../agent/agent.js';

// Reusable chat surface. Messages are { who: 'user' | 'agent', text }.
//
// Controlled mode (persisted chats): pass `messages` and `onSend(text)`; the
// caller posts to the API and the log updates from the server response.
// Local mode (helper bubble): omit them and the client-side stub answers.
export default function AgentChat({
  scope = 'general',
  context = {},
  greeting,
  placeholder = 'Ask for help...',
  messages,
  onSend,
  autoFocus = false,
}) {
  const controlled = Array.isArray(messages);
  const [local, setLocal] = useState(greeting ? [{ who: 'agent', text: greeting }] : []);
  const [pending, setPending] = useState(null); // user text awaiting the server
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  let log = controlled ? messages : local;
  if (controlled && !log.length && greeting) log = [{ who: 'agent', text: greeting }];
  if (pending) log = [...log, { who: 'user', text: pending }];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length, busy]);

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    try {
      if (controlled) {
        setPending(text);
        await onSend(text);
      } else {
        setLocal((l) => [...l, { who: 'user', text }]);
        const reply = await ask({ scope, context, message: text });
        setLocal((l) => [...l, { who: 'agent', text: reply }]);
      }
    } catch (err) {
      setError(err.message ?? 'Something went wrong');
      setInput(text);
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="agent-log">
        {log.map((m, i) => (
          <div key={i} className={`msg ${m.who}`}>
            {m.text}
          </div>
        ))}
        {busy && <div className="msg agent muted">thinking...</div>}
        {error && <div className="error">{error}</div>}
        <div ref={endRef} />
      </div>
      <form className="agent-input" onSubmit={send}>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
          placeholder={placeholder}
          aria-label="Message"
          autoFocus={autoFocus}
        />
        <button type="submit" className="btn btn-agent" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </>
  );
}
