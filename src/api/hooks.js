// Data hooks. Pages use these instead of a local store; TanStack Query caches
// responses and refetches after writes.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import { streamMessage } from './stream.js';

export const keys = {
  me: ['me'],
  agentSettings: ['agent-settings'],
  class: (id) => ['class', id],
  conversation: (id) => ['conversation', id],
};

// User, institution, classes (with studentCount), assignments across classes, announcements.
export const useMe = (enabled = true) => useQuery({ queryKey: keys.me, queryFn: () => api.get('/me'), enabled });

// Class, membership, assignments (avg + done), roster (instructors), digest, conversations.
export const useClass = (id) => useQuery({ queryKey: keys.class(id), queryFn: () => api.get(`/classes/${id}`), enabled: Boolean(id) });

export const useConversation = (id) =>
  useQuery({ queryKey: keys.conversation(id), queryFn: () => api.get(`/conversations/${id}`), enabled: Boolean(id) });

// Instructor creates; student joins by course number.
export function useCreateClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/classes', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useCreateAssignment(classId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post(`/classes/${classId}/assignments`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.class(classId) });
      qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useToggleDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, done }) => api.post(`/assignments/${id}/done`, { done }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.me });
      qc.invalidateQueries({ queryKey: ['class'] });
    },
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ classId, title }) => api.post(`/classes/${classId}/conversations`, title ? { title } : {}),
    onSuccess: (_data, { classId }) => qc.invalidateQueries({ queryKey: keys.class(classId) }),
  });
}

// Sends the user's message and streams the agent's reply straight into the
// conversation cache: the user turn appears as soon as the server stores it,
// then a `streaming` agent message grows token by token until `done` swaps in
// the stored row. Resolves with the finished agent message.
const STREAMING_ID = 'streaming';

export function useSendMessage(conversationId, classId) {
  const qc = useQueryClient();
  const key = keys.conversation(conversationId);
  const patch = (fn) => qc.setQueryData(key, (old) => (old ? fn(old) : old));
  const withoutPartial = (msgs) => msgs.filter((m) => m.id !== STREAMING_ID);

  return useMutation({
    mutationFn: (body) =>
      streamMessage(conversationId, body, {
        onUser: ({ title, message }) =>
          patch((old) => ({ ...old, conversation: { ...old.conversation, title }, messages: [...old.messages, message] })),
        onDelta: (text) =>
          patch((old) => {
            const last = old.messages[old.messages.length - 1];
            const partial =
              last?.id === STREAMING_ID
                ? { ...last, body: last.body + text }
                : { id: STREAMING_ID, conversationId, sender: 'agent', body: text, streaming: true };
            return { ...old, messages: [...withoutPartial(old.messages), partial] };
          }),
      }),
    onSuccess: (message) => {
      patch((old) => ({ ...old, messages: [...withoutPartial(old.messages), message] }));
      if (classId) qc.invalidateQueries({ queryKey: keys.class(classId) });
    },
    onError: () => patch((old) => ({ ...old, messages: withoutPartial(old.messages) })),
  });
}

// The one agent's global base prompt (agent_settings row).
export const useAgentSettings = () => useQuery({ queryKey: keys.agentSettings, queryFn: () => api.get('/agent-settings') });

export function useUpdateAgentSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (basePrompt) => api.patch('/agent-settings', { basePrompt }),
    onSuccess: (data) => qc.setQueryData(keys.agentSettings, data),
  });
}

// Per-course instructions appended to the base prompt. Instructor of the course only.
export function useUpdateClassAgent(classId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentInstructions) => api.patch(`/classes/${classId}/agent`, { agentInstructions }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.class(classId) }),
  });
}

// Canvas link (personal access token). Status rides on /me as `canvas`.
// Invalidate on settle, not only on success: a failed sync may still have
// written some classes, and the card should reflect what the server holds.
export function useConnectCanvas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ baseUrl, token }) => api.post('/canvas/connect', { baseUrl, token }),
    onSettled: () => qc.invalidateQueries(),
  });
}

export function useSyncCanvas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/canvas/sync'),
    onSettled: () => qc.invalidateQueries(),
  });
}

export function useDisconnectCanvas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del('/canvas'),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}
