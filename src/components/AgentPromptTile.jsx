import { useEffect, useState } from 'react';
import Tile from './Tile.jsx';
import { useAgentSettings, useUpdateAgentSettings, useUpdateClassAgent } from '../api/hooks.js';

// Instructor-only tile: edit this course's agent instructions, and (collapsed)
// the global base prompt shared by every course.
export default function AgentPromptTile({ cls }) {
  const settings = useAgentSettings();
  const saveBase = useUpdateAgentSettings();
  const saveCourse = useUpdateClassAgent(cls.id);

  const [instructions, setInstructions] = useState(cls.agentInstructions ?? '');
  const [basePrompt, setBasePrompt] = useState('');
  const [showBase, setShowBase] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => setInstructions(cls.agentInstructions ?? ''), [cls.id, cls.agentInstructions]);
  useEffect(() => {
    if (settings.data) setBasePrompt(settings.data.basePrompt);
  }, [settings.data]);

  const flash = (what) => {
    setSaved(what);
    setTimeout(() => setSaved(null), 2000);
  };

  const courseDirty = instructions !== (cls.agentInstructions ?? '');
  const baseDirty = settings.data && basePrompt !== settings.data.basePrompt;

  return (
    <Tile title={`${cls.agentName} instructions`} span={12} action={<span className="chip chip-agent">✦ one agent, per-course guidance</span>}>
      <p className="muted">
        The agent always follows the base prompt. Anything you write here is added on top for this course only, so you can
        steer it toward your material without removing the guardrails.
      </p>

      <div className="field">
        <label htmlFor="agent-instructions">Instructions for {cls.code}</label>
        <textarea
          id="agent-instructions"
          className="input"
          rows={5}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Never provide complete C programs. Point students to the man page and ask for their compiler output first."
        />
      </div>
      <div className="row between">
        <span className="muted">
          {cls.instructionsUpdatedAt ? `Last updated ${new Date(cls.instructionsUpdatedAt).toLocaleString()}` : 'Not customized yet'}
          {saved === 'course' && <span className="chip chip-agent" style={{ marginLeft: 8 }}>Saved</span>}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!courseDirty || saveCourse.isPending}
          onClick={() => saveCourse.mutateAsync(instructions).then(() => flash('course'))}
        >
          {saveCourse.isPending ? 'Saving...' : 'Save course instructions'}
        </button>
      </div>
      {saveCourse.error && <p className="error">{saveCourse.error.message}</p>}

      <button type="button" className="link-btn" onClick={() => setShowBase((v) => !v)}>
        {showBase ? 'Hide' : 'Show'} the base prompt (shared by every course)
      </button>
      {showBase && (
        <>
          <div className="field">
            <label htmlFor="agent-base">Base prompt</label>
            <textarea id="agent-base" className="input" rows={8} value={basePrompt} onChange={(e) => setBasePrompt(e.target.value)} disabled={settings.isLoading} />
          </div>
          <div className="row between">
            <span className="muted">
              Changing this affects every course.
              {saved === 'base' && <span className="chip chip-agent" style={{ marginLeft: 8 }}>Saved</span>}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!baseDirty || saveBase.isPending}
              onClick={() => saveBase.mutateAsync(basePrompt).then(() => flash('base'))}
            >
              {saveBase.isPending ? 'Saving...' : 'Save base prompt'}
            </button>
          </div>
          {saveBase.error && <p className="error">{saveBase.error.message}</p>}
        </>
      )}
    </Tile>
  );
}
