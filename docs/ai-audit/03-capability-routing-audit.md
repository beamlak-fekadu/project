# 03 — Capability Routing Audit

## File: `src/services/chatbot/capability-registry.ts`, `classifier-service.ts`

## Current Capability List (25 capabilities)

```
assistant_intro, general_conversation, off_topic_safe,
my_tasks, prioritize_tasks, summarize_work_order, summarize_equipment,
explain_equipment_risk, explain_pm_status, safe_troubleshooting,
maintenance_tips, logistics_status, procurement_status,
summarize_alerts, summarize_department_readiness, training_status,
disposal_status, qr_asset_context, offline_sync_status,
report_summary, metric_debug, copilot_diagnostics, usage_status,
unsafe_or_restricted, general_system_fallback
```

## Intent-to-Capability Map (from `INTENT_TO_CAPABILITY`)

| Intent | Maps to Capability |
|---|---|
| `troubleshooting` | `safe_troubleshooting` |
| `safe_troubleshooting` | `safe_troubleshooting` |
| `work_order_status` | `prioritize_tasks` |
| `maintenance_status` | `prioritize_tasks` |
| `equipment_lookup` | `summarize_equipment` |
| `analytics_explanation` | `summarize_department_readiness` |
| `risk_analysis` | `explain_equipment_risk` |
| `dashboard_summary` | `summarize_department_readiness` |
| `decision_support` | `summarize_department_readiness` |
| `maintenance_tip` (DEFAULT) | `maintenance_tips` |

## Critical Finding 1: `work_order_status` Maps to `prioritize_tasks`, Not `summarize_work_order`

**File:** `classifier-service.ts` line 556

When a user asks "What is the status of work order WO-1234?", the intent is `work_order_status` which maps to `prioritize_tasks` instead of `summarize_work_order`. The user gets a prioritized task list instead of the specific work order summary they asked for.

**Fix required:** `work_order_status` should map to `summarize_work_order` when a specific work order ID is detected, and to `prioritize_tasks` only for broad "which work orders need attention" queries.

## Critical Finding 2: `analytics_explanation` Maps to `summarize_department_readiness`

**File:** `classifier-service.ts` line 560

The `analytics_explanation` intent is a broad catch-all (matches "risk", "report", "metric", "qr", "usage", etc.) and all of it maps to `summarize_department_readiness`. This means asking "Explain the risk score for this asset" routes to department readiness instead of `explain_equipment_risk`.

The page-aware capability override (`derivePageAwareCapability`) partially fixes this when the user is on a relevant page, but fails for the global chatbot or when the page context doesn't match.

## Critical Finding 3: Dual Routing System Creates Confusion

There are TWO routing layers:
1. **Classifier routing:** `INTENT_TO_CAPABILITY` map (line 546) and `CAPABILITY_KEYWORDS` scoring (line 318)
2. **Page-aware override:** `derivePageAwareCapability()` in `assistant-orchestrator.ts` (line 68)

The top capability from `CAPABILITY_KEYWORDS` scoring can override the `INTENT_TO_CAPABILITY` mapping (line 758), and then the page-aware override can override that again. This triple-override creates unpredictable routing.

## Critical Finding 4: Missing Capabilities

The following data retrieval scenarios have no dedicated capability:

| Missing Capability | Current Behavior | Impact |
|---|---|---|
| `inventory_search` (search assets by department/category) | Falls to `summarize_equipment` or `summarize_department_readiness` | No way to search/filter fleet |
| `asset_history` (maintenance event timeline) | Falls to `summarize_equipment` | History is embedded in summary, not focused |
| `command_center_snapshot` | Falls to `summarize_department_readiness` | Same as department readiness, no Command Center specific flow |
| `score_formula_explanation` | Falls to `explain_equipment_risk` | No clean way to explain how scores are calculated without asset context |
| `navigation_help` | Falls to `general_system_fallback` | No page-navigation assistance |

## Critical Finding 5: Every Capability Uses `ALL_SECTIONS`

**File:** `capability-registry.ts` line 15-22

```typescript
const ALL_SECTIONS = ['summary', 'actions', 'insights', 'recommendations', 'escalation_guidance', 'confidence'];

// Every single capability:
responseSections: ALL_SECTIONS,
```

This means the output contract asks Gemini to populate troubleshooting_steps, escalation_guidance, maintenance_tips, etc. for EVERY response — even pure summaries. Gemini interprets this as "fill in all these fields" and generates troubleshooting content for summary requests.

## Dangerous Mappings

| Intent | Current Capability | Should Be |
|---|---|---|
| `work_order_status` | `prioritize_tasks` | `summarize_work_order` (with WO ID) or `prioritize_tasks` (without) |
| `analytics_explanation` | `summarize_department_readiness` | Depends on context — should fan out to the relevant analytics capability |
| `maintenance_tip` (default) | `maintenance_tips` → `general_system_fallback` | Should be `general_system_question` |
| `calibration_or_logistics` | `logistics_status` | Should split based on whether user asked about calibration vs logistics |

## Recommended Target Capability Model (~25 capabilities)

Keep the current 25 capabilities but fix the routing:

1. Fix `INTENT_TO_CAPABILITY` so `work_order_status` → `summarize_work_order`
2. Split `analytics_explanation` routing by entity context
3. Change default fallback from `maintenance_tip` to a neutral `general_system_question`
4. Add `responseSections` differentiation per capability (summary-only vs full operational)
5. Consider adding `inventory_search` and `asset_history` as distinct capabilities

## Files That Need Future Changes

1. **`classifier-service.ts`** — Fix `INTENT_TO_CAPABILITY` map, add entity-aware routing
2. **`capability-registry.ts`** — Differentiate `responseSections` per capability
3. **`assistant-orchestrator.ts`** — Simplify dual routing to single decision point
