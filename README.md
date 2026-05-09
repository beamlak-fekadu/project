This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## System-Wide AI Copilot (Groq + Safety Gating)

The platform includes a **system-wide biomedical AI copilot**:

- Global assistant launcher available throughout authenticated dashboard routes.
- Right-side assistant panel with persistent session continuity while navigating modules.
- Contextual Ask-AI entry points in equipment detail, work-order detail, PM, analytics risk, decision-support, and logistics views.
- Dedicated full workspace at `/chatbot`.

The assistant is backend-controlled and safety-gated for medical equipment operations support.

### 1) Environment configuration

Create your env file from `.env.example` and set:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
GEMINI_MODEL=gemini-2.5-flash
```

Optional Gemini controls:

```bash
GEMINI_TEMPERATURE=0.1
GEMINI_TIMEOUT_MS=30000
GEMINI_RETRY_COUNT=1
GEMINI_MAX_COMPLETION_TOKENS=900
```

### 2) Safety decision flow

The backend enforces policy before any model call:

1. Identify authenticated user and role scope.
2. Classify request intent.
3. Retrieve grounded context from Supabase (equipment/work orders/PM/calibration/logistics/analytics/manual snippets).
4. Evaluate evidence sufficiency and safety policy.
5. If blocked, return structured refusal/redirect without calling LLM.
6. If allowed, call Gemini and validate structured JSON output contract.

Decisions:

- `answer`
- `limited_answer`
- `check_manual`
- `escalate`
- `refuse`

### 3) Persistence and RLS

- Chat sessions and messages persist in:
  - `chat_sessions`
  - `chat_messages`
- Schema + policies are defined in:
  - `supabase/migrations/00015_chatbot_tables.sql`
- RLS enforces ownership-based access, with admin visibility where policy allows.

### 4) Go-live checklist

- [ ] Apply `supabase/migrations/00015_chatbot_tables.sql`.
- [ ] Set `AI_PROVIDER=gemini` and valid `GEMINI_API_KEY`.
- [ ] Run `npm run lint` and `npm run build`.
- [ ] Validate contextual assistant entry points from major modules.
- [ ] Validate refusal/escalation behavior for unsupported or unsafe prompts.
- [ ] Validate role-scoped visibility (`department_user`, `technician`, `admin`) and context restrictions.

## Command Center Operating Rules

The `/command` page is the BME Head operational control room. The system may recommend,
rank, score, and explain, but final operational decisions remain with the BME Head.

- Exact record actions: row-level actions open exact records when they exist, such as
  work orders, maintenance requests, PM schedules, procurement requests, and replacement evidence.
- Prefilled creation: when no workflow record exists, Command Center actions open a prefilled
  creation flow with asset/part/work-order context and `source=command-center`.
- Informational signals: Risk Watch items are acknowledged/snoozed by signal hash or converted
  into workflow items; generic module routing is reserved for "View all" links.
- Count consistency: summary cards, triage tabs, drilldowns, and critical actions must share
  the same fetcher/source of truth for the same metric.
- Explainability: every composite score shown in Command Center must be clickable/explainable
  with formula, criteria/weights, raw inputs, normalized inputs where applicable, source/method,
  generated reason, and history/timestamp when available.
- Roles: developer has BME Head plus thesis/testing controls, BME Head gets the operational
  control room, viewer is read-only, and training triage is hidden from BME Head for now pending
  a later Department Head workflow.

## Command Center Action Semantics

1. Exact record rule: row-level actions must open exact records when records exist.
2. Prefilled creation rule: if no record exists, open a prefilled creation flow with context.
3. Informational signal rule: informational signals use acknowledge/snooze or convert-to-workflow.
4. Count consistency rule: summary card, triage tab, drilldown, Work Queue & Assignment, and critical action count must share the same fetcher/source for the same metric.
5. State-aware action labels: Assign for unassigned work, Reassign for assigned work, View Progress for in-progress work, Resolve Blocker for on-hold work.
6. Future triage categories: new triage categories must define record IDs, exact routes, and prefilled fallback flows before being shown in the Command Center.
7. BME Head principle: the system recommends/explains; the BME Head decides.
