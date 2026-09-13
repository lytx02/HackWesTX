// Mock data for the POC. Everything is frontend-only for now; the DataContext
// seeds itself from this file and persists changes to localStorage.

export const institutions = [
  { id: 'okstate', name: 'Oklahoma State University', domains: ['okstate.edu'] },
  { id: 'ou', name: 'University of Oklahoma', domains: ['ou.edu'] },
  { id: 'utexas', name: 'University of Texas at Austin', domains: ['utexas.edu'] },
  { id: 'mit', name: 'Massachusetts Institute of Technology', domains: ['mit.edu'] },
  { id: 'ubc', name: 'University of British Columbia', domains: ['ubc.ca', 'student.ubc.ca'] },
  { id: 'oxford', name: 'University of Oxford', domains: ['ox.ac.uk'] },
];

// Ladder from deep purple to stark black, plus one purple tinted toward cream.
// Every value is a mix of the three Chalk inks - no fourth hue.
export const CLASS_COLORS = ['#4710C1', '#7146C7', '#3C1299', '#311470', '#261746', '#1B191E'];

export const classes = [
  {
    id: 'cs4283',
    code: 'CS 4283 / 5383',
    name: 'Computer Networks',
    instructor: 'Dr. A. Borah',
    term: 'Fall 2026',
    color: '#4710C1',
    overview:
      'Socket programming in C, TCP/IP, application and transport layers, routing, and the CSX server lab environment.',
    agentName: 'Packet',
    agentBlurb: 'Your Computer Networks assistant. I know the CSX servers, socket programming, and every project spec for this course.',
  },
  {
    id: 'math3013',
    code: 'MATH 3013',
    name: 'Linear Algebra',
    instructor: 'Dr. L. Chen',
    term: 'Fall 2026',
    color: '#7146C7',
    overview: 'Vector spaces, linear transformations, eigenvalues, and applications.',
    agentName: 'Vector',
    agentBlurb: 'Linear Algebra helper. Ask me to walk through eigenvalues, row reduction, or your problem sets.',
  },
  {
    id: 'engl3323',
    code: 'ENGL 3323',
    name: 'Technical Writing',
    instructor: 'Prof. M. Ortiz',
    term: 'Fall 2026',
    color: '#3C1299',
    overview: 'Memos, reports, proposals, and documentation for technical audiences.',
    agentName: 'Draft',
    agentBlurb: 'Technical Writing coach. I help outline, tighten, and format your reports.',
  },
];

// `avg` is the class-wide average (percent) once graded; null = not graded yet.
export const assignments = [
  {
    id: 'a1',
    classId: 'cs4283',
    title: 'Programming Project 0: Client/Server Date & Time',
    due: '2026-09-09',
    done: true,
    avg: 91,
    details: 'Execute the given TCP client/server C programs on the CSX servers and submit a PDF with screenshots.',
  },
  {
    id: 'a2',
    classId: 'cs4283',
    title: 'Reading: Kurose & Ross Ch. 2 (Application Layer)',
    due: '2026-09-14',
    done: false,
    avg: null,
    details: 'Sections 2.1 to 2.4. Short quiz in class.',
  },
  {
    id: 'a7',
    classId: 'cs4283',
    title: 'Quiz 1: Layers and Protocols',
    due: '2026-09-04',
    done: true,
    avg: 78,
    details: 'In-class quiz covering chapter 1.',
  },
  {
    id: 'a8',
    classId: 'cs4283',
    title: 'Exam 1',
    due: '2026-10-07',
    done: false,
    avg: null,
    details: 'Chapters 1 to 3.',
  },
  {
    id: 'a3',
    classId: 'math3013',
    title: 'Problem Set 3: Vector Spaces',
    due: '2026-09-16',
    done: false,
    avg: null,
    details: 'Problems 3.1 to 3.4, odd numbers only.',
  },
  {
    id: 'a9',
    classId: 'math3013',
    title: 'Problem Set 2: Matrices',
    due: '2026-09-02',
    done: true,
    avg: 84,
    details: 'Row reduction and inverses.',
  },
  {
    id: 'a4',
    classId: 'engl3323',
    title: 'Memo Draft 1',
    due: '2026-09-18',
    done: false,
    avg: null,
    details: 'One page internal memo proposing a process improvement.',
  },
  {
    id: 'a5',
    classId: 'cs4283',
    title: 'Programming Project 1: Echo Server',
    due: '2026-09-23',
    done: false,
    avg: null,
    details: 'Extend Project 0 so the server echoes client messages. Handle multiple sequential clients.',
  },
  {
    id: 'a6',
    classId: 'math3013',
    title: 'Midterm 1',
    due: '2026-09-30',
    done: false,
    avg: null,
    details: 'Covers chapters 1 to 3.',
  },
];

export const students = [
  { id: 's1', name: 'Aiden Park', email: 'aiden.park@okstate.edu', classIds: ['cs4283', 'math3013'], avg: 93 },
  { id: 's2', name: 'Bella Nguyen', email: 'bella.nguyen@okstate.edu', classIds: ['cs4283'], avg: 88 },
  { id: 's3', name: 'Carlos Reyes', email: 'carlos.reyes@okstate.edu', classIds: ['cs4283', 'engl3323'], avg: 71 },
  { id: 's4', name: 'Dana Whitfield', email: 'dana.whitfield@okstate.edu', classIds: ['cs4283', 'math3013'], avg: 82 },
  { id: 's5', name: 'Elijah Osei', email: 'elijah.osei@okstate.edu', classIds: ['cs4283'], avg: 64 },
  { id: 's6', name: 'Fatima Khan', email: 'fatima.khan@okstate.edu', classIds: ['cs4283', 'engl3323'], avg: 95 },
  { id: 's7', name: 'Grace Lindqvist', email: 'grace.l@okstate.edu', classIds: ['math3013', 'engl3323'], avg: 79 },
  { id: 's8', name: 'Hiro Tanaka', email: 'hiro.tanaka@okstate.edu', classIds: ['cs4283', 'math3013'], avg: 86 },
];

// AI Digest bullets per class. kind: 'alert' | 'suggestion' | 'notice'
export const digests = {
  cs4283: [
    {
      kind: 'alert',
      text: 'Students are struggling with bind() and connect() error handling in Programming Project 0. Suggestion: post a short walkthrough of the common perror outputs before Project 1 opens.',
    },
    {
      kind: 'suggestion',
      text: 'Quiz 1 average was 78%, with most misses on the transport vs. application layer distinction. Suggestion: spend ten minutes on the layer model at the start of Monday\'s lecture.',
    },
    {
      kind: 'notice',
      text: '3 students have not submitted Project 0 and it is a prerequisite for Project 1. A reminder with the CSX login guide would help.',
    },
  ],
  math3013: [
    {
      kind: 'alert',
      text: 'Students are struggling with subspace proofs in Problem Set 3. Suggestion: add a worked example on closure under addition.',
    },
    { kind: 'notice', text: 'Midterm 1 is in two and a half weeks. No review session is scheduled yet.' },
  ],
  engl3323: [
    { kind: 'suggestion', text: 'Several students asked the assistant how long a memo should be. Suggestion: pin a length guideline to the assignment.' },
  ],
};

// Student AI Helper conversations per class.
export const chats = [
  {
    id: 'c1',
    classId: 'cs4283',
    title: 'bind() vs connect()',
    createdAt: '2026-09-08T14:00:00Z',
    messages: [
      { who: 'user', text: 'Why does the client call connect() but the server calls bind()?' },
      {
        who: 'agent',
        text: 'The server binds so the OS knows which port to listen on. The client does not care which local port it gets, so it just connects to the server address and the OS picks a port for it.',
      },
    ],
  },
  {
    id: 'c2',
    classId: 'cs4283',
    title: 'Why read() needs a buffer size',
    createdAt: '2026-09-10T09:30:00Z',
    messages: [
      { who: 'user', text: 'What happens if the buffer is smaller than the message?' },
      { who: 'agent', text: 'read() fills what fits and returns that many bytes. The rest stays in the socket until you call read() again, so loop until you have everything you expect.' },
    ],
  },
  {
    id: 'c3',
    classId: 'math3013',
    title: 'Checking if a set is a subspace',
    createdAt: '2026-09-11T20:15:00Z',
    messages: [{ who: 'user', text: 'What are the three things I need to check?' }, { who: 'agent', text: 'Contains the zero vector, closed under addition, closed under scalar multiplication.' }],
  },
];

export const announcements = [
  {
    id: 'n1',
    source: 'institution',
    title: 'Fall Break: Oct 15 to 16',
    body: 'No classes. Campus offices remain open with reduced hours.',
    date: '2026-09-10',
  },
  {
    id: 'n2',
    source: 'institution',
    title: 'CSX servers maintenance window',
    body: 'csx0 through csx3 will reboot Saturday 2:00 AM to 4:00 AM. Save your work.',
    date: '2026-09-11',
  },
  {
    id: 'n3',
    source: 'agent',
    title: 'Reminder from your assistant',
    body: 'Computer Networks reading is due Monday. Want me to build a study outline?',
    date: '2026-09-12',
  },
];
