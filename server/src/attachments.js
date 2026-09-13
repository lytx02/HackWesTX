// Chat attachments: images and PDFs sent with a message as base64. PDFs are
// reduced to text here so the model can read them; images are kept as data
// URLs (shown in the chat, and sent to the model only when VLLM_VISION=true).
// Stored on messages.attachments (jsonb) so later turns still see the text.

import { extractText } from 'unpdf';
import { badRequest } from './http.js';

export const MAX_ATTACHMENTS = 4;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_CHARS = 30_000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export const isImage = (a) => IMAGE_TYPES.has(a?.type);

export async function parseAttachments(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw badRequest('attachments must be an array');
  if (raw.length > MAX_ATTACHMENTS) throw badRequest(`At most ${MAX_ATTACHMENTS} files per message`);

  const out = [];
  for (const a of raw) {
    const name = typeof a?.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 200) : 'file';
    const type = typeof a?.type === 'string' ? a.type.toLowerCase() : '';
    if (type !== 'application/pdf' && !IMAGE_TYPES.has(type)) {
      throw badRequest(`${name}: only images (PNG, JPEG, GIF, WebP) and PDFs can be attached`);
    }
    if (typeof a.data !== 'string' || !a.data) throw badRequest(`${name}: missing file data`);
    const buf = Buffer.from(a.data, 'base64');
    if (!buf.length) throw badRequest(`${name}: file is empty`);
    const limit = type === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
    if (buf.length > limit) throw badRequest(`${name}: must be under ${Math.round(limit / 1024 / 1024)} MB`);

    const item = { name, type, size: buf.length };
    if (type === 'application/pdf') {
      let text = '';
      try {
        const result = await extractText(new Uint8Array(buf), { mergePages: true });
        item.pages = result.totalPages;
        text = (result.text ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      } catch {
        throw badRequest(`${name}: could not read this PDF`);
      }
      item.truncated = text.length > MAX_PDF_CHARS;
      item.text = text.slice(0, MAX_PDF_CHARS);
    } else {
      item.dataUrl = `data:${type};base64,${buf.toString('base64')}`;
    }
    out.push(item);
  }
  return out;
}

// What the model reads for a turn's attachments.
export function describeAttachments(list) {
  if (!list?.length) return '';
  return list
    .map((a) => {
      if (a.type === 'application/pdf') {
        const meta = [a.pages ? `${a.pages} page(s)` : null, a.truncated ? 'text truncated' : null].filter(Boolean).join(', ');
        return `[Attached PDF: ${a.name}${meta ? ` (${meta})` : ''}]\n${a.text || '(no extractable text)'}`;
      }
      return `[Attached image: ${a.name}]`;
    })
    .join('\n\n');
}

// Message text + attachment text, as one string for the model.
export const messageWithAttachments = (body, list) => [body, describeAttachments(list)].filter(Boolean).join('\n\n');

// Stored history row -> row whose body includes its attachment text.
export const withAttachmentText = (m) => (m.attachments?.length ? { ...m, body: messageWithAttachments(m.body, m.attachments) } : m);

export const imageUrls = (list) => (list ?? []).filter(isImage).map((a) => a.dataUrl).filter(Boolean);
