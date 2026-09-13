import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { assignments, chats, classes, digests, students, CLASS_COLORS } from '../data/mock.js';

// Frontend-only data store. Seeded from mock.js, persisted to localStorage.
// Bump STORAGE_KEY when the mock schema changes so stale data is dropped.
const STORAGE_KEY = 'campus-ai.data.v2';
const DataContext = createContext(null);

const uid = () => Math.random().toString(36).slice(2, 9);

function seed() {
  return {
    classes,
    assignments,
    students,
    digests,
    chats,
    // Which classes each role sees. POC: both roles see all seeded classes.
    memberships: {
      student: classes.map((c) => c.id),
      instructor: classes.map((c) => c.id),
    },
  };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ?? seed();
  } catch {
    return seed();
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_CLASS': {
      const { role, name, code, overview, instructor } = action;
      const cls = {
        id: uid(),
        code,
        name,
        overview,
        instructor,
        term: 'Fall 2026',
        color: CLASS_COLORS[state.classes.length % CLASS_COLORS.length],
        agentName: name.split(/\s+/)[0] || 'Helper',
        agentBlurb: `Your ${name} assistant.`,
      };
      return {
        ...state,
        classes: [...state.classes, cls],
        memberships: { ...state.memberships, [role]: [...state.memberships[role], cls.id] },
      };
    }
    case 'JOIN_CLASS': {
      // Student "Add class": join an existing class by course number, else create a placeholder.
      const code = action.code.trim().toLowerCase();
      const existing = state.classes.find((c) => c.code.toLowerCase() === code);
      if (existing) {
        if (state.memberships.student.includes(existing.id)) return state;
        return { ...state, memberships: { ...state.memberships, student: [...state.memberships.student, existing.id] } };
      }
      return reducer(state, { type: 'ADD_CLASS', role: 'student', name: action.name, code: action.code, overview: '', instructor: 'TBD' });
    }
    case 'ADD_ASSIGNMENT': {
      const a = { id: uid(), done: false, avg: null, ...action.assignment };
      return { ...state, assignments: [...state.assignments, a] };
    }
    case 'TOGGLE_DONE':
      return { ...state, assignments: state.assignments.map((a) => (a.id === action.id ? { ...a, done: !a.done } : a)) };
    case 'ADD_CHAT': {
      const chat = { id: action.id ?? uid(), classId: action.classId, title: action.title, createdAt: new Date().toISOString(), messages: [] };
      return { ...state, chats: [chat, ...state.chats] };
    }
    case 'ADD_MESSAGE':
      return {
        ...state,
        chats: state.chats.map((c) => (c.id === action.chatId ? { ...c, messages: [...c.messages, action.message] } : c)),
      };
    case 'RENAME_CHAT':
      return { ...state, chats: state.chats.map((c) => (c.id === action.chatId ? { ...c, title: action.title } : c)) };
    case 'RESET':
      return seed();
    default:
      return state;
  }
}

export function DataProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable; keep in memory */
    }
  }, [state]);

  const value = useMemo(
    () => ({
      ...state,
      dispatch,
      classById: (id) => state.classes.find((c) => c.id === id),
      classesFor: (role) => state.memberships[role].map((id) => state.classes.find((c) => c.id === id)).filter(Boolean),
      assignmentsFor: (classId) => state.assignments.filter((a) => a.classId === classId),
      studentsFor: (classId) => state.students.filter((s) => s.classIds.includes(classId)),
      chatsFor: (classId) => state.chats.filter((c) => c.classId === classId),
      addChat: (classId, title = 'New conversation') => {
        const id = uid();
        dispatch({ type: 'ADD_CHAT', id, classId, title });
        return id;
      },
    }),
    [state]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);
