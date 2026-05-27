# 00 — BMEDIS Copilot AI Audit: Executive Summary

**Audit date:** 2026-05-27
**Audited by:** Deep read-only inspection of production source files
**Production code modified:** None

---

## 1. Where the AI Pipeline Is Located

All copilot logic lives in `src/services/chatbot/`. The entry point is `src/app/api/chat/route.ts`.

The core files are:

| File | Role |
|---|---|
| `src/app/api/chat/route.ts` | HTTP entry, auth, profile load, message persistence |
| `src/services/chatbot/assistant-orchestrator.ts` | Main 22-step orchestration chain |
| `src/services/chatbot/classifier-service.ts` | Intent classification (32 intents, regex-based) |
| `src/services/chatbot/capability-registry.ts` | 25 capabilities with routing metadata |
| `src/services/chatbot/safety-service.ts` | Safety decision: answer / limited_answer / refuse |
| `src/services/chatbot/prompt-service.ts` | System prompt + Gemini output contract |
| `src/services/chatbot/context-service.ts` | Supabase evidence loading |
| `src/services/chatbot/task-context-service.ts` | Formal tool system + task context |
| `src/services/chatbot/deterministic-answer-builders.ts` | Data-grounded answer builders (best part) |
| `src/services/chatbot/response-usefulness-guard.ts` | Replaces generic LLM output with deterministic answers |

---

## 2. Top 5 Reasons Copilot Answers Are Bad

### Reason 1: Global system prompt bleeds troubleshooting instructions into every response

**File:** `prompt-service.ts` line 27

`"For troubleshooting, provide safe first-line checks only."` is in the **global** `CHATBOT_SYSTEM_PROMPT`, not scoped to the troubleshooting capability. Every Gemini call — asset summaries, department readiness, report help, analytics — receives this instruction. Gemini interprets it as the default answer style and generates safe check boilerplate even when the user asked for a summary.

**Impact:** A user asking "Summarize ED-0002" gets: summary + "Check power cables, verify accessories, escalate if alarms" — fields they never asked for.

---

### Reason 2: Classifier patterns steal summary and status queries into troubleshooting

**File:** `classifier-service.ts` lines 256–271

Words like `fault`, `failure`, `ultrasound`, and `patient monitor` trigger the `troubleshooting` intent even when the question is a status or inventory query. Once classified as troubleshooting, the entire pipeline shifts to safety-limited mode.

**Examples of broken routing:**
- "Which ultrasound units are in the ED?" → `troubleshooting` (should be `inventory_search`)
- "What is the failure count for this monitor?" → `troubleshooting` (should be `analytics_explanation`)
- "What is the work order status for WO-2024-0891?" → `prioritize_tasks` (should be `summarize_work_order`)

---

### Reason 3: Universal output contract tells Gemini to always generate troubleshooting fields

**File:** `prompt-service.ts` lines 216–246

The `outputContract` sent to Gemini is identical for every capability and always includes `troubleshooting_steps`, `likely_causes`, `maintenance_tips`, and `escalation_guidance`. Because these fields exist in the contract, Gemini fills them — even for an asset summary or department readiness query.

---

### Reason 4: Safety service forces `limited_answer` for all troubleshooting regardless of evidence quality

**File:** `safety-service.ts` lines 398–409

Any query classified as `troubleshooting` or `calibration_or_logistics` always returns `limited_answer` decision, unconditionally. Even if the system has full maintenance history, calibration records, and PM data for the asset, the answer is degraded to generic safe guidance.

---

### Reason 5: Wrong default fallback intent

**File:** `classifier-service.ts` line 813

When no intent pattern matches, the classifier returns `maintenance_tip` as the default. This means unrecognized questions — conversational queries, general help, search queries — get routed to the maintenance context and produce unsolicited maintenance tips.

---

## 3. Is the Intent Classifier a Problem?

**Yes — confirmed.** Three specific problems:

1. Overly broad troubleshooting patterns (`fault`, `failure`, `ultrasound`) steal non-troubleshooting queries
2. Missing intents for `asset_summary` and `inventory_search` — these common query types have no dedicated pattern
3. Wrong default fallback (`maintenance_tip`) for unclassified queries
4. `work_order_status` intent maps to `prioritize_tasks` capability (wrong)

The classifier is the first point of failure. Fixing it (Phase 2) has cascading positive effects throughout the pipeline.

---

## 4. Is the Capability Router a Problem?

**Yes — confirmed, partially.** Two specific problems:

1. `INTENT_TO_CAPABILITY` map: `work_order_status` → `prioritize_tasks` is incorrect
2. `ALL_SECTIONS` is used for every capability in `capability-registry.ts` — no differentiation in response shape
3. Missing capabilities: `inventory_search`, `asset_history_summary`, `command_center_snapshot`

The dual routing system (classifier + page-aware override in `assistant-orchestrator.ts` lines 68–123) is architecturally correct but obscures the routing path for debugging.

---

## 5. Is Safety Overreach a Problem?

**Yes — confirmed. This is the #1 root cause.**

Three layers of safety overreach compound each other:
1. Global system prompt (line 27 in `prompt-service.ts`) — applies to every capability
2. Universal output contract — always includes troubleshooting fields
3. Unconditional `limited_answer` for any troubleshooting intent (lines 398–409 in `safety-service.ts`)

The safety system was designed for troubleshooting queries but its instructions apply globally. The result is that summaries, analytics, and workflow queries are all answered in "safe troubleshooting mode" whether or not the user asked for troubleshooting help.

---

## 6. Are Response Contracts Missing?

**Yes — confirmed.**

There is one output contract for all 25 capabilities. It includes every possible response field. Gemini receives it and fills what it can — including fields that are semantically incorrect for the query type.

The `deterministic-answer-builders.ts` (1200+ lines) is the best part of the pipeline. It produces focused, data-grounded responses per capability. But it is only used as a fallback when the LLM output is detected as generic, not as the primary path.

---

## 7. Are Context Loaders Weak?

**Yes — confirmed, in two specific places:**

1. **Logistics data** only loads when intent is `calibration_or_logistics` or `maintenance_tip`. Stock blockers are missing from prioritization and decision support queries.
2. **Department analytics** (PM compliance, recommendation flags) only load when intent is `analytics_explanation`. Department summaries routed via other intents receive incomplete context.
3. The `intentForEvidence` mapping in `task-context-service.ts` (lines 347–363) converts capabilities back to intents with `maintenance_tip` as the default — an incorrect translation layer.

The formal tool system (`planFormalTools`) is well-designed and capability-differentiated. It is the stronger of the two context systems.

---

## 8. What Should Be Fixed First

In order of priority:

1. **Narrow troubleshooting classifier patterns** (`classifier-service.ts`) — highest leverage single fix
2. **Remove troubleshooting instructions from global system prompt** (`prompt-service.ts` line 27)
3. **Add "do not generate troubleshooting fields unless capability is safe_troubleshooting"** to system prompt
4. **Fix `work_order_status` → `summarize_work_order` mapping** (`classifier-service.ts` line 556)
5. **Change default fallback from `maintenance_tip` to `general_conversation`** (`classifier-service.ts` line 813)

These five changes address the top 3 root causes and are low-to-medium risk.

---

## 9. What Should NOT Be Changed Yet

- **Gemini model or provider** — not the problem; see section 10
- **`deterministic-answer-builders.ts`** — the best part of the pipeline; do not refactor
- **`copilot-rbac.ts`** — role model is correct and complete; no changes needed
- **`role-prompt-policy.ts`** — well-designed per-role behavior and tone; no changes needed
- **Authentication and profile loading in `route.ts`** — works correctly
- **RAG / pgvector document retrieval** — working correctly
- **Conversation memory and thread context** — working correctly
- **`ROLE_PRIORITY` array** — ordering is correct by design
- **Safety refusal for clinical diagnosis** — correct behavior; do not relax

---

## 10. Confirmation: Gemini Model Does Not Need to Change

**Confirmed.** The problems identified in this audit are **architectural and configuration problems**, not model capability problems:

- Safety overreach is caused by system prompt placement, not model behavior
- Wrong routing is caused by regex patterns and intent mapping, not model understanding
- Generic responses are caused by the universal output contract, not model quality
- Context gaps are caused by intent-gated evidence loading, not model knowledge

Gemini 2.5 Flash is capable of producing precise, data-grounded responses when given the correct capability-scoped system prompt, the correct output contract, and sufficient evidence. The model does not need to be changed or upgraded to fix these issues.

---

## Audit Files Index

| File | Contents |
|---|---|
| `01-pipeline-map.md` | End-to-end flow from UI through 22-step orchestration chain |
| `02-intent-classification-audit.md` | All 32 intents; 6 critical findings; 24-intent target model |
| `03-capability-routing-audit.md` | All 25 capabilities; wrong mappings; missing capabilities |
| `04-safety-overreach-audit.md` | Root cause analysis; exact lines; 3 failure examples; 5-mode target |
| `05-context-loading-audit.md` | All loaders with conditions; 4 critical findings; target asset packet |
| `06-response-contracts-and-formatting-audit.md` | Universal output contract; deterministic builders; target modes |
| `07-role-and-permission-context-audit.md` | Role model audit; RBAC findings; no old email addresses |
| `08-test-coverage-and-failure-cases.md` | 80 test prompts in 18 groups with expected routing and failure analysis |
| `09-prioritized-fix-plan.md` | 7 phases; 16 specific fixes; risk levels; defense requirements |
| `copilot-pipeline-inventory.json` | Complete inventory of ~60 files with risk level and purpose |
