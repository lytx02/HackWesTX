// Checks the configured RunPod vLLM instance: `npm run llm:ping`.
// 1) GET /v1/models  2) a short streamed completion with terminal usage.
// Exit code 1 if either step fails. Pass --no-chat to only do step 1.

import { ping, streamChat } from '../src/llm.js';

const result = await ping();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
if (process.argv.includes('--no-chat')) process.exit(0);

const started = Date.now();
let firstDeltaMs = null;
let chars = 0;
let usage = null;
try {
  process.stdout.write('\nmodel> ');
  for await (const delta of streamChat([
    { role: 'system', content: 'You are a terse assistant.' },
    { role: 'user', content: 'Reply with one short sentence confirming you are online.' },
  ], {
    onUsage: (value) => { usage = value; },
  })) {
    firstDeltaMs ??= Date.now() - started;
    chars += delta.length;
    process.stdout.write(delta);
  }
  console.log('\n');
  console.log(JSON.stringify({
    ok: true,
    completion: {
      firstDeltaMs,
      chars,
      latencyMs: Date.now() - started,
    },
    usage,
    usageDiagnostic: usage ? 'reported by vLLM' : 'not reported by vLLM',
  }, null, 2));
} catch (error) {
  console.error(`\n\nchat failed: ${error.message}`);
  process.exit(1);
}
