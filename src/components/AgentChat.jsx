import { useEffect, useRef, useState } from 'react';
import { streamHelper } from '../api/stream.js';

// Reusable chat surface. Messages are { who: 'user' | 'agent', text, streaming? }.
//
// Controlled mode (persisted class chats): pass `messages` and `onSend(text)`;
// the caller streams the reply into its own store and the log re-renders as
// it grows (a message with `streaming: true` shows a cursor).
// Local mode (helper bubble): omit them and the log lives here, streamed from
// POST /agent/stream.
export default function AgentChat({
  greeting,
  placeholder = 'Ask for help...',
  messages,
  onSend,
  autoFocus = false,
}) {
  const controlled = Array.isArray(messages);
  const [local, setLocal] = useState(greeting ? [{ who: 'agent', text: greeting }] : []);
  // The user's text shown optimistically until the server echoes it back
  // (controlled mode adds it to `messages` on the `user` event).
  const [pending, setPending] = useState(null); // { text, baseLen }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  let log = controlled ? messages : local;
  if (controlled && !log.length && greeting) log = [{ who: 'agent', text: greeting }];
  if (pending && (!controlled || messages.length <= pending.baseLen)) log = [...log, { who: 'user', text: pending.text }];
  const streaming = log[log.length - 1]?.streaming;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length, busy, log[log.length - 1]?.text.length]);

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    try {
      if (controlled) {
        setPending({ text, baseLen: messages.length });
        await onSend(text);
      } else {
        const history = local.filter((m) => m.text !== greeting);
        setLocal((l) => [...l, { who: 'user', text }]);
        await streamHelper(text, history, {
          onDelta: (delta) =>
            setLocal((l) => {
              const last = l[l.length - 1];
              return last?.streaming
                ? [...l.slice(0, -1), { ...last, text: last.text + delta }]
                : [...l, { who: 'agent', text: delta, streaming: true }];
            }),
        });
        setLocal((l) => l.map((m) => (m.streaming ? { who: 'agent', text: m.text } : m)));
      }
    } catch (err) {
      setError(err.message ?? 'Something went wrong');
      setInput(text);
      if (!controlled) setLocal((l) => l.filter((m) => !m.streaming && m.text !== text));
    } finally {
      setPending(null);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="agent-log">
        {log.map((m, i) => (
          <div key={i} className={`msg ${m.who}${m.streaming ? ' streaming' : ''}`}>
            {m.text}
          </div>
        ))}
        {busy && !streaming && <div className="msg agent muted">thinking...</div>}
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
