# 09 — Prioritized Fix Plan

## Overview

Seven phases ordered by impact and dependency. Each phase builds on the last. Phases 1–3 are required before any public demo or thesis defense. Phases 4–7 improve quality but are non-blocking.

---

## Phase 1 — Diagnosis and Logging

**Goal:** Add non-breaking observability so every response is traceable before any structural changes are made.

---

### Fix 1.1 — Log intent, capability, and safety decision per response

**Files:** `src/app/api/chat/route.ts`, `src/services/chatbot/assistant-orchestrator.ts`

**Change:** Add a structured log line (console or telemetry) after orchestration completes:
```
[copilot] intent=troubleshooting capability=safe_troubleshooting decision=limited_answer evidence=weak role=technician duration=1423ms
```

**Risk level:** Very low — logging only, no behavior change.

**Expected benefit:** Immediately shows which queries are misclassified. Can be reviewed in Vercel/server logs without code change.

**Suggested test:** Send "Summarize ED-0002" and verify log shows `intent`, `capability`, and `decision`.

**Required before defense:** Yes — needed to confirm the other fixes actually work.

---

### Fix 1.2 — Add `classificationDebug` field to response payload (dev-only)

**Files:** `src/services/chatbot/assistant-orchestrator.ts`, `src/types/chatbot.ts`

**Change:** When `NODE_ENV !== 'production'` or when the user has `developer` role, attach a `_debug` field to the assistant response:
```json
{
  "_debug": {
    "intent": "troubleshooting",
    "capability": "safe_troubleshooting",
    "decision": "limited_answer",
    "routingSource": "classifier",
    "safetyMode": "elevated",
    "evidenceKeys": ["equipment", "maintenanceHistory"],
    "deterministicPath": false
  }
}
```

**Risk level:** Low — only exposed to `developer` role; no change to non-developer responses.

**Expected benefit:** Allows developer to see exactly why each response was generated without reading logs.

**Suggested test:** Log in as developer, ask "What is the PM status for ICU-MV-001?", verify `_debug.intent` is `explain_pm_status` not `troubleshooting`.

**Required before defense:** No — helpful for ongoing debugging but not blocking.

---

### Fix 1.3 — Add deterministic path indicator to telemetry

**Files:** `src/services/chatbot/assistant-orchestrator.ts`, `src/services/chatbot/response-usefulness-guard.ts`

**Change:** Track whether the final response came from Gemini, deterministic builder (primary), or deterministic fallback (guard replacement). Log this per request.

**Risk level:** Very low.

**Expected benefit:** Reveals how often Gemini output is overridden by the usefulness guard — which tells us how bad the LLM output actually is in practice.

**Suggested test:** Review logs after 20 queries; count how many hit the guard override path.

**Required before defense:** No.

---

## Phase 2 — Intent Classification Correction

**Goal:** Stop misclassifying summary and status queries as troubleshooting.

---

### Fix 2.1 — Narrow troubleshooting regex patterns

**File:** `src/services/chatbot/classifier-service.ts` lines 256–271

**Change:** Remove standalone word matches that steal non-troubleshooting queries. Before:
```typescript
/\bfault\b/i,
/\bfailure\b/i,
/\bultrasound\b/i,
/\bpatient monitor\b/i,
```

After — require action context:
```typescript
/\b(fault|error|failure)\b.{0,30}\b(check|fix|diagnose|not working|won't start|issue)\b/i,
/\b(ultrasound|monitor|ventilator)\b.{0,40}\b(problem|issue|not working|broken|fault)\b/i,
```

**Risk level:** Medium — changing regex patterns can affect real troubleshooting queries. Must test with 10+ known-good troubleshooting prompts.

**Expected benefit:** "Which ultrasound units are in the ED?" will no longer route to `safe_troubleshooting`. "What is the failure count for this monitor?" will route to analytics instead.

**Suggested test:** Run the 18 test groups from `08-test-coverage-and-failure-cases.md`, groups "Failure count and analytics queries" and "Inventory and search queries". Verify `intent` is no longer `troubleshooting` for status questions.

**Required before defense:** Yes — this is the single highest-leverage fix.

---

### Fix 2.2 — Add `asset_summary` and `inventory_search` intents

**File:** `src/types/chatbot.ts`, `src/services/chatbot/classifier-service.ts`

**Change:** Add two new intents to `CHAT_INTENTS`:
- `asset_summary` — "summarize", "tell me about", "what is [asset]", "details for"
- `inventory_search` — "which [equipment] are in [department]", "list all", "how many [category]"

Add patterns to `INTENT_PATTERNS`. These must be ranked above `troubleshooting` in the scoring array.

**Risk level:** Medium — new intents require new capability mappings. If not mapped, they fall through to default `maintenance_tip`.

**Expected benefit:** "Summarize ED-0002" routes to `asset_summary` → `summarize_equipment` instead of falling through to `maintenance_tip` or being stolen by troubleshooting.

**Suggested test:** Test groups "Equipment summary queries" and "Inventory and search queries" from test coverage doc.

**Required before defense:** Yes.

---

### Fix 2.3 — Fix `work_order_status` → `summarize_work_order` mapping

**File:** `src/services/chatbot/classifier-service.ts` line 556

**Change:**
```typescript
// Before:
work_order_status: 'prioritize_tasks',

// After:
work_order_status: 'summarize_work_order',
```

**Risk level:** Low — `summarize_work_order` capability already exists. This is a one-line fix.

**Expected benefit:** "What is the status of WO-2024-0891?" will return work order details instead of a task prioritization list.

**Suggested test:** Ask "What is the status of WO-2024-0891?" and confirm response contains work order fields, not a generic priority list.

**Required before defense:** Yes.

---

### Fix 2.4 — Change default fallback intent from `maintenance_tip` to `general_conversation`

**File:** `src/services/chatbot/classifier-service.ts` line 813

**Change:**
```typescript
// Before:
return { intent: 'maintenance_tip', confidence: 0 };

// After:
return { intent: 'general_conversation', confidence: 0 };
```

**Risk level:** Low — `general_conversation` is a safer default; routes to text-mode response instead of structured maintenance guidance.

**Expected benefit:** Unrecognized queries stop producing unsolicited maintenance tips.

**Suggested test:** Ask "Hello, can you help me?" and verify response is conversational, not a maintenance checklist.

**Required before defense:** Yes.

---

### Fix 2.5 — Separate `analytics_explanation` from department summary routing

**File:** `src/services/chatbot/classifier-service.ts` line 560

**Change:**
```typescript
// Before:
analytics_explanation: 'summarize_department_readiness',

// After:
analytics_explanation: 'analytics_explanation',  // keep as self-routed
```

Add `analytics_explanation` as its own capability in `capability-registry.ts` if not already present, or map it to `command_center_summary` for department analytics.

**Risk level:** Medium — requires checking that `analytics_explanation` capability is correctly defined.

**Expected benefit:** "Explain the MTBF trend for this ventilator" routes to equipment analytics, not department readiness.

**Suggested test:** Ask "What is the reliability score for ICU-VT-003?" and confirm response contains MTBF/MTTR data, not a department summary.

**Required before defense:** No — helpful but not blocking.

---

## Phase 3 — Safety Mode Separation

**Goal:** Isolate troubleshooting safety logic so it does not contaminate summaries, analytics, or workflow queries.

---

### Fix 3.1 — Remove troubleshooting instructions from global system prompt

**File:** `src/services/chatbot/prompt-service.ts` lines 18–31

**Change:** Remove the line:
```
"For troubleshooting, provide safe first-line checks only. Never provide internal board-level repair..."
```
from `CHATBOT_SYSTEM_PROMPT`. Move it to a capability-specific addendum that is only injected when `capability === 'safe_troubleshooting'`.

Add the addendum injection in the prompt builder:
```typescript
if (capability === 'safe_troubleshooting') {
  systemPrompt += SAFE_TROUBLESHOOTING_ADDENDUM;
}
```

**Risk level:** Medium — removing a safety instruction from the global prompt is a significant change. Must verify troubleshooting responses still include safety language.

**Expected benefit:** "Summarize ED-0002" will stop producing troubleshooting boilerplate. This is the root fix for the #1 problem.

**Suggested test:** Ask "Summarize ED-0002" — confirm response does NOT contain "Check power cables" or "Escalate if alarms". Then ask "The ventilator is making an unusual noise, what should I check?" — confirm response DOES contain safe first-line checks.

**Required before defense:** Yes.

---

### Fix 3.2 — Allow `answer` decision for troubleshooting with strong evidence

**File:** `src/services/chatbot/safety-service.ts` lines 398–409

**Change:** Replace the unconditional `limited_answer` return with an evidence-quality check:
```typescript
// Before:
if (intent === 'troubleshooting' || intent === 'calibration_or_logistics') {
  return { decision: 'limited_answer', ... };
}

// After:
if (intent === 'troubleshooting' || intent === 'calibration_or_logistics') {
  const strongEvidence = hasEvidence && evidence.equipment && evidence.maintenanceHistory?.length > 0;
  return {
    decision: strongEvidence ? 'answer' : 'limited_answer',
    answerBasis: strongEvidence ? 'system_data' : 'general_safe_guidance',
    ...
  };
}
```

**Risk level:** Medium — allows more complete answers for troubleshooting. Must ensure the bounded troubleshooting builder still enforces safe-check limits.

**Expected benefit:** Troubleshooting queries with good asset data get actual system history, not just generic safe checks.

**Suggested test:** Ask "The infusion pump is alarming — what does the history show?" with an asset that has maintenance records. Confirm response includes maintenance history data.

**Required before defense:** No — helpful but Phase 3.1 is the critical fix.

---

### Fix 3.3 — Remove default safe checks from non-troubleshooting blocked responses

**File:** `src/services/chatbot/assistant-orchestrator.ts` lines 278–347

**Change:** In `buildBlockedAssistantContent()`, only inject `defaultSafeChecks` when the block reason is troubleshooting-related:
```typescript
const includeSafeChecks = blockReason === 'too_detailed_troubleshooting'
  || blockReason === 'unsafe_request'
  || intent === 'troubleshooting';

if (includeSafeChecks) {
  content.troubleshootingSteps = defaultSafeChecks;
}
```

**Risk level:** Low — only affects blocked response format.

**Expected benefit:** A blocked `out_of_scope` response (e.g., "Diagnose this patient") no longer includes safe check boilerplate.

**Suggested test:** Ask an out-of-scope question ("Diagnose this patient's condition") and confirm the refusal response does NOT include equipment safe check steps.

**Required before defense:** No.

---

### Fix 3.4 — Add explicit "do not generate troubleshooting steps" instruction for non-troubleshooting capabilities

**File:** `src/services/chatbot/prompt-service.ts`

**Change:** Add to the global system prompt:
```
"Unless the capability is safe_troubleshooting, do NOT generate troubleshooting_steps, likely_causes, or maintenance_tips in your response. Leave those fields empty."
```

**Risk level:** Low — adds a constraint, does not remove any existing behavior.

**Expected benefit:** Even if Gemini receives the full output contract, it will not fill troubleshooting fields for summary responses.

**Suggested test:** Ask "What is the PM compliance for the ICU?" and verify response has no troubleshooting steps or maintenance tips.

**Required before defense:** Yes — cheap fix, high impact.

---

## Phase 4 — Context Packet Cleanup

**Goal:** Ensure the right data is loaded for each capability before the LLM or deterministic builder runs.

---

### Fix 4.1 — Load logistics for all operational capabilities

**File:** `src/services/chatbot/context-service.ts` line 130

**Change:**
```typescript
// Before:
if (intent === 'calibration_or_logistics' || intent === 'maintenance_tip') {
  // load spare_parts
}

// After:
const operationalIntents = [
  'calibration_or_logistics', 'maintenance_tip', 'prioritize_tasks',
  'decision_support', 'work_order_status', 'troubleshooting'
];
if (operationalIntents.includes(intent)) {
  // load spare_parts
}
```

**Risk level:** Low — adds more data to context; does not remove any.

**Expected benefit:** Stock blockers appear in prioritization and work order responses.

**Suggested test:** Ask "What are the top priorities for the BME team today?" and confirm response mentions stock blockers if any exist.

**Required before defense:** No — helpful but not blocking.

---

### Fix 4.2 — Replace `intentForEvidence` mapping with capability-based evidence config

**File:** `src/services/chatbot/task-context-service.ts` lines 347–363

**Change:** Replace the `intentForEvidence` conversion with a direct capability lookup:
```typescript
const CAPABILITY_EVIDENCE_CONFIG: Record<string, EvidenceConfig> = {
  summarize_equipment: { loadLogistics: false, loadAnalytics: true },
  summarize_work_order: { loadLogistics: true, loadAnalytics: false },
  prioritize_tasks: { loadLogistics: true, loadAnalytics: true },
  summarize_department_readiness: { loadLogistics: false, loadAnalytics: true },
  // ...
};
```

**Risk level:** Medium — replaces a core evidence routing mechanism. Must test all capabilities.

**Expected benefit:** Evidence loading is predictable and capability-driven. No more `maintenance_tip` as the hidden default.

**Suggested test:** Verify evidence keys in `_debug` output for 5 different capability types.

**Required before defense:** No.

---

### Fix 4.3 — Add missing data flags to `ChatEvidence`

**File:** `src/services/chatbot/context-service.ts`, `src/types/chatbot.ts`

**Change:** Add a `missingDataFlags: string[]` field to `ChatEvidence`. When a query includes `equipmentId` but `calibrationRecords` comes back empty, push `'calibration_records_missing'` to the flags array. Expose this in the response.

**Risk level:** Low.

**Expected benefit:** Users see "Calibration data not available for this asset" instead of silence. Reduces confusion when the assistant gives a partial answer.

**Suggested test:** Ask about an asset with no calibration records. Confirm response says "Calibration data not on file."

**Required before defense:** No.

---

## Phase 5 — Response Mode Contracts

**Goal:** Give each capability a distinct output shape so Gemini knows exactly what to produce.

---

### Fix 5.1 — Remove troubleshooting fields from non-troubleshooting output contracts

**File:** `src/services/chatbot/prompt-service.ts` lines 216–246

**Change:** Create capability-specific `outputContract` builders:
```typescript
function buildOutputContract(capability: CapabilityId): OutputContract {
  const base = { decision, intelligence_mode, summary, actions, insights, recommendations };
  if (capability === 'safe_troubleshooting') {
    return { ...base, troubleshooting_steps, likely_causes, required_tools_or_parts, escalation_guidance };
  }
  if (capability === 'summarize_equipment') {
    return { ...base, asset_identity, compliance_status, risk_summary, open_work_count };
  }
  // etc.
  return base;
}
```

**Risk level:** High — changing the output contract changes what Gemini generates. Must test every capability type.

**Expected benefit:** Gemini stops generating unsolicited troubleshooting fields for summary responses. Response quality improves significantly.

**Suggested test:** Run the full 18 test groups from `08-test-coverage-and-failure-cases.md`. Verify must-not-include conditions pass for all groups.

**Required before defense:** No — Phase 3.4 is a cheaper interim fix. This is the complete solution.

---

### Fix 5.2 — Define `responseSections` per capability instead of using `ALL_SECTIONS`

**File:** `src/services/chatbot/capability-registry.ts` lines 15–22

**Change:** Remove `ALL_SECTIONS`. Define `responseSections` per capability:
```typescript
{
  id: 'summarize_equipment',
  responseSections: ['summary', 'key_findings', 'recommended_actions', 'compliance_status'],
  // NOT: troubleshooting_steps, maintenance_tips, likely_causes
}
```

**Risk level:** Medium — affects UI rendering. Sections not in `responseSections` must not be shown.

**Expected benefit:** UI does not render empty or irrelevant sections for non-troubleshooting responses.

**Suggested test:** View an asset summary response in the UI. Confirm no troubleshooting step section appears.

**Required before defense:** No.

---

### Fix 5.3 — Add semantic validation in `normalizeAssistantResponse`

**File:** `src/services/chatbot/assistant-response-pipeline.ts`

**Change:** After JSON normalization, add a capability-specific validator:
```typescript
function validateResponseSemantics(response, capability) {
  if (capability !== 'safe_troubleshooting' && response.troubleshooting_steps?.length > 0) {
    response.troubleshooting_steps = [];  // strip unsolicited troubleshooting
  }
  if (capability === 'summarize_department_readiness' && !response.readiness_score) {
    response._validation_warning = 'missing_readiness_score';
  }
}
```

**Risk level:** Low — post-processing step that strips invalid fields.

**Expected benefit:** Even if Gemini produces troubleshooting steps for a summary, they are stripped before reaching the UI.

**Suggested test:** Manually inject a response with troubleshooting fields for an asset summary. Confirm they are stripped.

**Required before defense:** No — Phase 3.4 prevents generation; this is defense in depth.

---

## Phase 6 — Test Suite

**Goal:** Add automated tests that catch regressions in the pipeline.

---

### Fix 6.1 — Add classifier unit tests for the 80 prompts in test coverage doc

**File:** `src/services/chatbot/__tests__/classifier-service.test.ts` (new or existing)

**Change:** Convert the 80 test prompts from `08-test-coverage-and-failure-cases.md` into Jest `it()` assertions:
```typescript
it('routes inventory query to correct capability', () => {
  const result = classifyChatRequest('Which ultrasound units are in the ED?', ...);
  expect(result.intent).not.toBe('troubleshooting');
  expect(result.capability).toBe('asset_listing');
});
```

**Risk level:** Zero — test-only change.

**Expected benefit:** Any future regex change that breaks a known-good query is caught immediately.

**Suggested test:** Run `npm test classifier-service`. All 80 pass after Phase 2 fixes are applied.

**Required before defense:** No — but strongly recommended.

---

### Fix 6.2 — Add safety service unit tests for role/intent combinations

**File:** `src/services/chatbot/__tests__/safety-service.test.ts` (new or existing)

**Change:** Test that `evaluateSafetyDecision` returns correct decision for:
- viewer asking troubleshooting question → `refuse`
- technician asking troubleshooting with strong evidence → `answer` (after Phase 3.2)
- admin asking asset summary → `answer`
- department_user asking department summary for own department → `answer`

**Risk level:** Zero.

**Expected benefit:** Confirms role-safety matrix works correctly after any refactor.

**Required before defense:** No.

---

### Fix 6.3 — Add deterministic builder coverage tests

**File:** `src/services/chatbot/__tests__/deterministic-answer-builders.test.ts` (new or existing)

**Change:** For each builder function, pass minimal mock evidence and assert the output shape:
- `buildAssetContextAnswer` — must include `asset_code`, `condition`, `pm_status`
- `buildWorkOrderAnswer` — must include `work_order_number`, `status`
- `buildTroubleshootingAnswer` — must include `troubleshooting_steps`, must NOT include `board_level_repair`

**Risk level:** Zero.

**Expected benefit:** Deterministic builders are the best part of the pipeline — protect them from regression.

**Required before defense:** No.

---

## Phase 7 — UI Rendering Improvements

**Goal:** Ensure `AssistantMessageCard.tsx` only renders sections relevant to the capability.

---

### Fix 7.1 — Suppress irrelevant sections in `AssistantMessageCard.tsx`

**File:** `src/components/assistant/AssistantMessageCard.tsx`

**Change:** Accept a `capability` prop (or read from response metadata). Use the `responseSections` defined in `capability-registry.ts` to gate section rendering:
```tsx
{capability === 'safe_troubleshooting' && response.troubleshooting_steps?.length > 0 && (
  <TroubleshootingStepsSection steps={response.troubleshooting_steps} />
)}
```

**Risk level:** Medium — frontend change. Requires visual review across all card types.

**Expected benefit:** Asset summary cards never show a "Troubleshooting Steps" section. Clean, focused UI.

**Suggested test:** Open asset summary in UI, confirm no troubleshooting section. Open a troubleshooting response, confirm steps section is present.

**Required before defense:** No — Phase 5.3 handles the data layer; this is the UI layer.

---

### Fix 7.2 — Add "missing data" indicator component

**File:** `src/components/assistant/AssistantMessageCard.tsx`, `src/components/assistant/MissingDataNotice.tsx` (new)

**Change:** When `response._missingDataFlags` is present and non-empty, render a subtle notice:
```
⚠ Calibration data not on file for this asset.
```

**Risk level:** Low — additive UI component.

**Expected benefit:** Users understand why an answer is incomplete instead of assuming the assistant failed.

**Required before defense:** No.

---

## Fix Priority Summary

| Priority | Fix | File(s) | Risk | Defense Required |
|---|---|---|---|---|
| 1 | 2.1 — Narrow troubleshooting patterns | `classifier-service.ts` | Medium | Yes |
| 2 | 3.1 — Remove safety from global prompt | `prompt-service.ts` | Medium | Yes |
| 3 | 3.4 — Add "no troubleshooting fields" instruction | `prompt-service.ts` | Low | Yes |
| 4 | 2.3 — Fix work_order_status mapping | `classifier-service.ts` | Low | Yes |
| 5 | 2.4 — Change default fallback to general_conversation | `classifier-service.ts` | Low | Yes |
| 6 | 2.2 — Add asset_summary and inventory_search intents | `classifier-service.ts`, `types/chatbot.ts` | Medium | Yes |
| 7 | 1.1 — Add structured logging | `route.ts`, `orchestrator.ts` | Very Low | Yes |
| 8 | 3.2 — Allow answer for troubleshooting with strong evidence | `safety-service.ts` | Medium | No |
| 9 | 3.3 — Remove safe checks from non-troubleshooting blocks | `orchestrator.ts` | Low | No |
| 10 | 4.1 — Load logistics for all operational capabilities | `context-service.ts` | Low | No |
| 11 | 5.1 — Capability-specific output contracts | `prompt-service.ts` | High | No |
| 12 | 5.2 — Capability responseSections per capability | `capability-registry.ts` | Medium | No |
| 13 | 5.3 — Semantic validation in normalizeAssistantResponse | `response-pipeline.ts` | Low | No |
| 14 | 4.2 — Replace intentForEvidence mapping | `task-context-service.ts` | Medium | No |
| 15 | 7.1 — Suppress irrelevant UI sections | `AssistantMessageCard.tsx` | Medium | No |
| 16 | 6.1 — Classifier unit tests for 80 prompts | `__tests__/` | Zero | No |

---

## What NOT to Change

- **Gemini model or provider** — the model is not the problem. These issues are architectural.
- **`deterministic-answer-builders.ts`** — the best part of the pipeline; do not refactor without specific need.
- **`copilot-rbac.ts`** and `role-prompt-policy.ts`** — role model is correct and clean.
- **`src/app/api/chat/route.ts` auth logic** — works correctly; default to viewer is safe.
- **`ROLE_PRIORITY` array in `copilot-rbac.ts`** — ordering is correct.
- **RAG / pgvector document retrieval** — working correctly; do not touch.
- **Conversation memory / thread context** — working correctly.
