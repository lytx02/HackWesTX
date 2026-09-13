// Data hooks. Pages use these instead of a local store; TanStack Query caches
// responses and refetches after writes.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

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

// Posts the user's message; the server stores it and the agent's reply, returning both.
export function useSendMessage(conversationId, classId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post(`/conversations/${conversationId}/messages`, { body }),
    onSuccess: (data) => {
      qc.setQueryData(keys.conversation(conversationId), (old) =>
        old
          ? { ...old, conversation: { ...old.conversation, title: data.title }, messages: [...old.messages, ...data.messages] }
          : old
      );
      if (classId) qc.invalidateQueries({ queryKey: keys.class(classId) });
    },
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
