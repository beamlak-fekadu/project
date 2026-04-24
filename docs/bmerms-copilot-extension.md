# BMERMS copilot extension (implementation notes)

This document summarizes the audit and the file-level scope for the Gemini biomedical operations copilot extension. The authoritative phased plan lives in the project planning artifact referenced in the PR.

## Existing architecture (reused)

- **API**: `src/app/api/chat/route.ts` — auth, `UserChatProfile`, sessions/messages.
- **Orchestration**: `src/services/chatbot/assistant-orchestrator.ts` — classify → memory → entities → task context → safety → prompt → LLM → telemetry → memory.
- **LLM**: `src/services/chatbot/providers/gemini-provider.ts` — Gemini OpenAI-compatible JSON mode.
- **Retrieval**: `task-context-service.ts`, `context-service.ts` — structured Supabase reads.
- **Policy**: `classifier-service.ts`, `safety-service.ts`.
- **Persistence**: `chat_sessions`, `chat_messages`, `chat_session_memory`, `chat_telemetry_events` (migrations `00016`, `00017`).

## Files changed in this extension

See git history for this PR; primary touch points include:

- `src/types/chatbot.ts` — capabilities, optional assistant fields, classifier hints.
- `src/app/api/chat/route.ts` — richer profile (e.g. department name).
- `src/services/chatbot/classifier-service.ts` — low-confidence routing, memory bias, new keywords.
- `src/services/chatbot/task-context-service.ts` — WO scoping, ranked priorities, readiness/training/disposal blocks, cross-module and proactive payloads, alert shaping.
- `src/services/chatbot/prompt-service.ts` — routing explanation, capability addenda, module context.
- `src/services/chatbot/assistant-orchestrator.ts` — classifier hint, telemetry metadata, merged proactive/routing on responses.
- `src/services/chatbot/conversation-memory-service.ts` — rolling summary from assistant output.
- `src/services/chatbot/providers/gemini-provider.ts` — empty/error handling, metadata.
- `src/services/chatbot/providers/normalize-provider-output.ts` — new optional assistant keys.
- `src/services/chatbot/capability-registry.ts` — new capability definitions.
- `src/services/chatbot/context-service.ts` — document-retrieval hook stub.
- New: `src/services/chatbot/troubleshooting-context.ts`, `src/services/chatbot/proactive-signals.ts` (or inlined helpers).
- Tests: `src/services/chatbot/__tests__/copilot-core.test.ts`, `src/services/chatbot/__tests__/gemini-provider.test.ts`.
- UI: `src/app/(dashboard)/chatbot/page.tsx` (and assistant panel if needed) for new assistant sections.
- Eval seeds: `src/services/chatbot/evaluation/capability-evaluation-dataset.ts`.

## Gemini connectivity (provider vs copilot)

**Request path**

- `POST /api/chat` → `orchestrateAssistantResponse` → `generateAssistantContent` → `getChatProvider().generate()` → `postGeminiChatCompletions` to `{GEMINI_BASE_URL}/chat/completions`.
- Production `generate()` sets `response_format: { type: 'json_object' }` because the assistant pipeline expects JSON that [`normalize-provider-output`](src/services/chatbot/providers/normalize-provider-output.ts) can parse into `AssistantContent`.
- If `generate()` throws, the orchestrator catch returns a **blocked** `check_manual`-style payload with `fallbackReason: 'provider_failure'` — that is **not** the same as a successful model reply; it can mask a pure provider outage.

**Environment**

| Variable | Role |
|----------|------|
| `AI_PROVIDER` | Must be `gemini` (default). Other values throw in `getChatProvider()`. |
| `GEMINI_API_KEY` | Required. |
| `GEMINI_BASE_URL` | Optional; must be a valid `http(s)` URL when set. |
| `GEMINI_MODEL` | Optional; default `gemini-2.5-flash`. |

**Debug flags (never log secrets or full prompts)**

| Flag | Effect |
|------|--------|
| `CHAT_AI_SMOKE_ENABLED=true` | Enables `GET`/`POST` `/api/ai-smoke-test` (404 when off). Requires a signed-in user. |
| `CHAT_DEBUG_PROVIDER_FLOW=true` | Extra server logs for `/api/chat` and orchestrator around the provider call. |
| `CHAT_DEBUG_POLICY` | Logs classifier/orchestrator decisions (existing). |
| `CHAT_DEBUG_RAW_PROVIDER` | Logs Gemini response metadata in provider (existing). |

**Smoke test**

1. Set `CHAT_AI_SMOKE_ENABLED=true` and valid `GEMINI_*` in `.env.local`.
2. Sign in to the app, then open `GET http://localhost:3000/api/ai-smoke-test` (or POST).
3. Success: `{ "ok": true, "content": "GEMINI_OK", ... }` — proves HTTP + auth + model without orchestration.
4. If smoke succeeds but `/api/chat` still shows `provider_failure` or odd summaries, the problem is likely **prompt JSON contract / normalization / safety**, not raw Gemini connectivity.

## Testing

- `npm run test:chatbot` for chatbot unit tests.
- Manual: `/chatbot` and floating assistant with `GEMINI_API_KEY` set.
- Gemini smoke: enable `CHAT_AI_SMOKE_ENABLED` and call `/api/ai-smoke-test` while authenticated.
