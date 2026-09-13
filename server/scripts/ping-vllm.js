// Checks the RunPod vLLM instance from the command line: `npm run llm:ping`.
// 1) GET /v1/models  2) a one-line streamed completion, printed as it arrives.
// Exit code 1 if either step fails. Pass --no-chat to only do step 1.

import { ping, streamChat } from '../src/llm.js';

const r = await ping();
console.log(JSON.stringify(r, null, 2));
if (!r.ok) process.exit(1);
if (process.argv.includes('--no-chat')) process.exit(0);

const started = Date.now();
let first = null;
let chars = 0;
try {
  process.stdout.write('\nmodel> ');
  for await (const delta of streamChat([
    { role: 'system', content: 'You are a terse assistant.' },
    { role: 'user', content: 'Reply with one short sentence confirming you are online.' },
  ])) {
    first ??= Date.now() - started;
    chars += delta.length;
    process.stdout.write(delta);
  }
  console.log(`\n\nok: first token ${first}ms, ${chars} chars in ${Date.now() - started}ms`);
} catch (e) {
  console.error(`\n\nchat failed: ${e.message}`);
  process.exit(1);
}
