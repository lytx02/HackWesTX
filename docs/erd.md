# Entity-Relationship Diagram — Course AI Helper

v2: one AI agent, with a global base prompt and instructor-editable per-course instructions.

Table names in the database differ from the ERD labels in two places, kept for
code stability: **COURSE** is the `classes` table and **CHAT** is `conversations`.
`institutions`, `sessions`, and `announcements` also exist in the database and are
omitted here because they are not part of the core model.

```mermaid
erDiagram
    USER ||--o{ ENROLLMENT : "is enrolled / teaches"
    COURSE ||--o{ ENROLLMENT : has
    COURSE ||--o{ ASSIGNMENT : has
    COURSE ||--o{ CHAT : "agent hosts"
    USER ||--o{ CHAT : owns
    CHAT ||--o{ MESSAGE : contains
    ASSIGNMENT ||--o{ SUBMISSION : receives
    USER ||--o{ SUBMISSION : submits
    COURSE ||--o{ DIGEST_ITEM : "agent writes"
    AGENT_SETTINGS ||--o{ COURSE : "base prompt applies to"
    USER ||--o{ AGENT_SETTINGS : updates
    USER ||--o{ COURSE : "instructor edits agent_instructions"

    USER {
        uuid id PK
        text email
        text role "student | instructor"
        text canvas_user_id "optional"
    }
    ENROLLMENT {
        uuid user_id FK
        uuid course_id FK
        text role
    }
    COURSE {
        uuid id PK
        text code
        text name
        text agent_name
        text agent_instructions "instructor-editable, nullable"
        uuid instructions_updated_by FK
        timestamp instructions_updated_at
        text canvas_course_id "optional"
    }
    AGENT_SETTINGS {
        int id PK "single row"
        text base_prompt
        uuid updated_by FK
        timestamp updated_at
    }
    ASSIGNMENT {
        uuid id PK
        uuid course_id FK
        text title
        date due_date
    }
    SUBMISSION {
        uuid assignment_id FK
        uuid student_id FK
        int grade_val "nullable for MVP"
    }
    CHAT {
        uuid id PK
        uuid course_id FK
        uuid user_id FK
        text title
    }
    MESSAGE {
        uuid id PK
        uuid chat_id FK
        text sender "user | agent"
        text body
    }
    DIGEST_ITEM {
        uuid id PK
        uuid course_id FK
        text kind "alert | suggestion | notice"
        text body
    }
```

## How the agent prompt is built

At chat time the server composes the system prompt as:

1. `agent_settings.base_prompt` (global, the "help, don't solve" rules), then
2. the course's code, name, and overview, then
3. `classes.agent_instructions` if the instructor has written any.

The instructor text is appended, never substituted, so the base guardrails always
apply. See `buildSystemPrompt()` in `server/src/agent.js`.
