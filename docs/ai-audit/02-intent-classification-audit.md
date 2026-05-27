# 02 — Intent Classification Audit

## File: `src/services/chatbot/classifier-service.ts`

## Current Intent List (32 intents)

```
assistant_intro, general_conversation, off_topic_safe, general_help,
workflow_help, maintenance_tip, troubleshooting, safe_troubleshooting,
work_order_help, work_order_status, maintenance_status, equipment_lookup,
equipment_history, analytics_explanation, risk_analysis, reliability_metrics,
replacement_priority, dashboard_summary, decision_support, preventive_maintenance,
calibration_status, spare_parts_lookup, logistics_stock, procurement_status,
training_status, disposal_status, report_help, calibration_or_logistics,
too_detailed, unsafe, unsafe_request, out_of_scope, insufficient_context
```

## Critical Finding 1: `troubleshooting` Intent Has Overly Broad Patterns

**File:** `classifier-service.ts` lines 256-271

The `troubleshooting` intent matches patterns that are NOT troubleshooting requests:

```typescript
patterns: [
  /\btroubleshoot/i,
  /\bfault\b/i,          // "What is the fault history?" → NOT troubleshooting
  /\bnot working\b/i,
  /\bfailure\b/i,         // "Show failure count" → NOT troubleshooting
  /\bfirst[-\s]?line checks?\b/i,
  /\bwhat should i check (next|first)\b/i,
  /\blikely causes?\b/i,
  /\bescalat(e|ion)\b/i,  // "Show escalation history" → NOT troubleshooting
  /\bultrasound\b/i,      // "Summarize the ultrasound" → NOT troubleshooting
  /\bpatient monitor\b/i, // "Status of patient monitors" → NOT troubleshooting
  /\bnot powering|won'?t power|no power|black screen|blank screen|image quality|artifact|artefact\b/i,
]
```

**Problem:** Words like "fault", "failure", "ultrasound", "patient monitor", "escalation" appear in summary/status/history questions that are not troubleshooting requests at all. "Summarize the ultrasound department" matches `\bultrasound\b/i` and routes to troubleshooting.

## Critical Finding 2: `analytics_explanation` Is a Catch-All Sink

**File:** `classifier-service.ts` lines 289-311

```typescript
intent: 'analytics_explanation',
patterns: [
  /\bmttr\b/i, /\bmtbf\b/i, /\bavailability\b/i, /\brisk\b/i,
  /\brpn\b/i, /\breplacement priority\b/i, /\bpm compliance\b/i,
  /\bpriority score\b/i, /\bwhy is .* high risk\b/i, /\boverdue pm\b/i,
  /\bdecision support\b/i, /\bmetric\b/i, /\bdata source\b/i,
  /\btelemetry\b/i, /\busage\b/i, /\boffline sync\b/i,
  /\bsync conflicts?\b/i, /\bqr\b/i, /\breport\b/i,
]
```

This matches `\breport\b/i` and `\brisk\b/i` which are extremely common words. "Generate a department readiness report" would hit analytics_explanation instead of report_help or department_summary.

## Critical Finding 3: Default Fallback Is `maintenance_tip`

**File:** `classifier-service.ts` lines 795-824

When no pattern matches, the classifier defaults to `maintenance_tip` intent with `general_system_fallback` capability. This means **any unrecognized question gets maintenance framing**, even if the user asked about reports, navigation, or system help.

## Critical Finding 4: Intent Pattern Order Creates Priority Bias

The `INTENT_PATTERNS` array (line 93) is iterated in order, and the **first match wins**. The `troubleshooting` intent (index ~16) comes before `work_order_help` (index ~17) and `equipment_lookup` (index ~18). This means troubleshooting-like words in an equipment status question will match troubleshooting before equipment_lookup gets a chance.

## Critical Finding 5: No Confidence Threshold Stops Bad Routing

There is no minimum confidence threshold. Even with confidence 0.38, the classifier proceeds with the top match. The `ambiguous` flag is set but only used for memory bias (line 798), not to trigger clarification.

## Critical Finding 6: Missing "Summary" and "Status" Intent Recognition

There is no explicit pattern for "Summarize [X]" as a general request type. The classifier has `summarize_equipment` and `summarize_work_order` as capability keywords, but at the intent level, the word "summarize" has no dedicated handling. "Summarize ED-0002" may match `equipment_lookup` (via `/\basset\b/i`) but could also match `troubleshooting` if the asset name contains trigger words.

## Ambiguous Prompt Examples

| Prompt | Likely Current Route | Correct Route |
|---|---|---|
| "Summarize ED-0002" | `equipment_lookup` → `summarize_equipment` (OK if asset_code detected, but could miss) | `asset_summary` |
| "What is the current status of ICU ventilators?" | `analytics_explanation` (via /\bavailability\b/) or `equipment_lookup` | `department_summary` or `inventory_search` |
| "Why is this asset high risk?" | `risk_analysis` → `explain_equipment_risk` (correct) | `risk_explanation` |
| "Show failure history for this monitor" | `troubleshooting` (via /\bfailure\b/ and /\bmonitor\b/) | `asset_history` or `equipment_lookup` |
| "Give me a Command Center summary" | `decision_support` → `summarize_department_readiness` (correct) | `command_center_summary` |
| "What reports are available?" | `analytics_explanation` (via /\breport\b/) | `report_help` |
| "Check calibration status" | `calibration_status` → `explain_pm_status` (correct) | `calibration_status` |
| "The monitor is not powering on" | `troubleshooting` (correct) | `safe_troubleshooting` |
| "Close this work order for me" | `work_order_help` (via /\bwork order\b/) | `unsupported_or_restricted_action` |
| "Summarize hospital readiness" | `dashboard_summary` → `summarize_department_readiness` (correct) | `command_center_summary` |

## Recommended Target Intent Model (20-25 intents)

### Core intents:
1. `asset_summary` — summarize/status for a specific asset
2. `asset_history` — maintenance/event history for an asset
3. `inventory_search` — search/filter assets by department/category/status
4. `work_order_status` — status/summary of work orders
5. `maintenance_request_status` — status of maintenance requests
6. `pm_status` — PM compliance, overdue PM
7. `calibration_status` — calibration due/overdue/records
8. `disposal_status` — disposal pipeline
9. `training_status` — training requests/coverage
10. `department_summary` — department readiness overview
11. `command_center_summary` — Command Center operational view
12. `risk_explanation` — explain risk scores, RPN, FMEA
13. `replacement_explanation` — explain replacement priority, RPI
14. `score_formula_explanation` — how scores are calculated
15. `report_help` — available reports, report evidence
16. `workflow_next_step` — how to do X in BMEDIS
17. `navigation_help` — where to find X
18. `role_permission_help` — what can my role do
19. `safe_troubleshooting` — safe first-line checks
20. `logistics_status` — stock/spare parts/procurement
21. `data_quality_check` — why is this metric zero/stale
22. `unsupported_or_restricted` — unsafe/out-of-scope
23. `general_conversation` — greetings, off-topic
24. `assistant_intro` — help/capabilities

### Slots/entities:
- `asset_id`, `asset_code`, `asset_name`
- `department`, `category`
- `work_order_id`, `request_id`
- `date_range`, `status`, `priority`
- `role`
- `requested_output_format` (summary, table, list, ranking)
- `summary_depth` (brief, detailed)

## Files That Need Future Changes

1. **`classifier-service.ts`** — Narrow troubleshooting patterns, add summary/status/history intent detection, change default fallback from `maintenance_tip` to `general_system_question`
2. **`types/chatbot.ts`** — Update `CHAT_INTENTS` array with cleaner intent set
3. **`capability-registry.ts`** — Update intent-to-capability mappings
4. **`safety-service.ts`** — Update intent references
