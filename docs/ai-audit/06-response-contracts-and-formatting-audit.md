# 06 — Response Contracts and Output Formatting Audit

## Files: `prompt-service.ts`, `assistant-response-pipeline.ts`, `deterministic-answer-builders.ts`, `capability-response-defaults.ts`, `AssistantMessageCard.tsx`

## Critical Finding 1: Single Output Schema for All Capabilities

**File:** `prompt-service.ts` lines 216-246

The `outputContract` in the prompt is identical for every capability:

```json
{
  "decision": "answer | limited_answer | check_manual | escalate | refuse",
  "intelligence_mode": "standard | troubleshooting | prioritization | synthesis",
  "summary": "string",
  "actions": "string[]",
  "insights": "string[]",
  "recommendations": "string[]",
  "escalation_guidance": "string | optional",
  "troubleshooting_steps": "string[]",
  "maintenance_tips": "string[]",
  "likely_causes": "string[]",
  "required_tools_or_parts": "string[]",
  ...
}
```

Every response is expected to have `troubleshooting_steps`, `maintenance_tips`, `likely_causes`, and `escalation_guidance` — even for a department readiness summary or a report help question. Gemini fills these in because the contract says they exist.

## Critical Finding 2: No Response Mode Differentiation

**File:** `capability-registry.ts`

Three response modes exist: `local`, `text`, `structured`. But:
- `local` is only used for `assistant_intro` and `unsafe_or_restricted`
- `text` is only used for `general_conversation`, `off_topic_safe`, and `general_system_fallback`
- **All other capabilities use `structured`** with the same schema

There are no differentiated modes like:
- `factual_summary` — identity + status + open work + compliance
- `status_card` — compact status with key fields
- `table` — tabular data (e.g., PM schedule, stock levels)
- `ranking` — ordered list with scores
- `safe_checklist` — bounded troubleshooting steps
- `analytics_explanation` — metric explanation with formula context
- `workflow_steps` — step-by-step guidance
- `missing_data_notice` — explicit "this data is not available" response

## Critical Finding 3: AssistantMessageCard Renders Everything

**File:** `src/components/assistant/AssistantMessageCard.tsx`

The message card renders all sections that have content — summary, key findings, recommended actions, troubleshooting steps, maintenance tips, etc. There is no logic to suppress irrelevant sections based on capability. If Gemini populates `troubleshooting_steps` for an asset summary, the UI shows them.

## Critical Finding 4: No Response Validator Exists

There is no post-generation validator that checks:
- "For asset_summary capability, troubleshooting_steps MUST be empty"
- "For safe_troubleshooting capability, troubleshooting_steps MUST have content"
- "For department_summary, response MUST include readiness score"

The `normalizeAssistantResponse` function validates JSON structure (field types, lengths) but not semantic correctness per capability.

## Critical Finding 5: Deterministic Builders Are the Best Part

**File:** `deterministic-answer-builders.ts` (1200+ lines)

The deterministic answer builders are actually excellent. They produce focused, data-grounded responses for each capability:
- `buildOperationalPriorityAnswer` — clean prioritization
- `buildAssetContextAnswer` — focused asset summary
- `buildWorkOrderAnswer` — work order status
- `buildDepartmentStatusAnswer` — department readiness
- `buildPmStatusAnswer` — PM compliance
- `buildCalibrationStatusAnswer` — calibration status
- `buildRiskAndReplacementAnswer` — risk/replacement evidence
- `buildStockBlockerAnswer` — stock blockers
- `buildTroubleshootingAnswer` — bounded safe checks

The `response-usefulness-guard.ts` replaces generic Gemini output with these when it detects generic patterns. **But this only works as a safety net, not as the primary path.**

## Target Response Modes

### For `asset_summary`:
```
- Identity: asset_code, name, department, category, manufacturer, model
- Current status: condition, status, criticality
- Open work: count of open work orders, latest request
- Compliance: PM status (compliance %), calibration (next due, last result)
- Risk/replacement: RPN, risk_level, RPI, rank
- Missing data: explicit list of what could not be loaded
- Suggested next review: link to asset profile
```

### For `work_order_status`:
```
- Work order: number, status, priority, type
- Asset: linked asset name and code
- Assigned: technician/engineer
- Blocker: parts needed, vendor wait, etc.
- Next action: based on status and role
- Missing evidence: what fields are empty
```

### For `command_center_summary`:
```
- Critical actions: top 3-5 ranked items
- Work queue: open WOs by priority
- Department readiness: score and key gaps
- Risk watch: high-risk assets
- Compliance: PM/calibration due
- Disposal/replacement: pending reviews
```

### For `safe_troubleshooting`:
```
- Safety boundary: clear statement of scope
- First-line checks: ordered checklist
- System context: recent history, PM/cal status
- Escalation criteria: when to stop and escalate
- What NOT to do: explicit restrictions
```

## Recommended Implementation

1. **Create capability-specific output schemas** in `prompt-service.ts` — remove `troubleshooting_steps` from non-troubleshooting output contracts
2. **Add response mode discrimination** in `AssistantMessageCard.tsx` — suppress sections not relevant to the capability
3. **Add post-generation validation** that checks semantic correctness per capability
4. **Promote deterministic builders to primary path** — use Gemini to enrich, not to generate from scratch
5. **Add `requested_output_format` slot** to classifier — detect when user asks for "table", "list", "ranking", "summary"

## Files That Need Future Changes

1. **`prompt-service.ts`** — Capability-specific output contracts
2. **`capability-registry.ts`** — Define `responseSections` per capability instead of `ALL_SECTIONS`
3. **`AssistantMessageCard.tsx`** — Suppress irrelevant sections by capability
4. **`assistant-response-pipeline.ts`** — Add semantic validation per capability
5. **`capability-response-defaults.ts`** — Add response templates per mode
