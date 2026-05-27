# 05 — Context Loading and Data Grounding Audit

## Files: `context-service.ts`, `task-context-service.ts`, `tools/`

## Current Context Loaders

### Core Evidence (`buildChatEvidence` in `context-service.ts`)

| Loader | Table/Query | Fields | Trigger Condition | Quality |
|---|---|---|---|---|
| Equipment | `equipment_assets` + joins | id, asset_code, name, condition, status, department_id, model, manufacturer, category, criticality | `equipmentId` present | Good — structured with FK joins |
| Work Order | `work_orders` + asset join | id, work_order_number, status, priority, work_type, root_cause, action_taken, closure_notes, created_at, asset | `workOrderId` present | Good |
| Department | `departments` | id, name, code | `departmentId` or profile department | Good |
| Maintenance History | `maintenance_events` | event_type, action_taken, failure_date, completion_date, notes, repair_duration_hours | `equipmentId` present | Good — limited to 8 records |
| PM Snapshot | `pm_compliance_metrics` | pmc_percentage, scheduled_count, completed_count, computed_at | `equipmentId` present | Good |
| Calibration Status | `calibration_records` | calibration_date, next_due_date, result, notes | `equipmentId` present | Good |
| Logistics Snapshot | `spare_parts` (low stock) | id, name, current_stock, reorder_level | `intent === 'calibration_or_logistics' OR 'maintenance_tip'` | **WEAK** — only 2 intents trigger this |
| Analytics (asset) | `equipment_risk_scores`, `equipment_reliability_metrics`, `replacement_priority_scores` | RPN, risk_level, MTTR, MTBF, availability, RPI, rank, justification | `equipmentId` present OR `intent === 'analytics_explanation'` | Good for asset-specific |
| Analytics (dept) | `pm_compliance_metrics` (dept), `recommendation_flags` | PM compliance per dept, flags | `intent === 'analytics_explanation'` AND no `equipmentId` | OK but intent-gated |
| Manuals/SOPs | `equipment_documents` | title, description, document_type | `equipmentId` present | OK — metadata only, no content |
| Document Retrieval (RAG) | pgvector `searchEquipmentDocuments` | chunk_text, source_label, chunk_index | Always if `GEMINI_API_KEY` set and message non-empty | Good |

### Task Context Blocks (`buildTaskContext` in `task-context-service.ts`)

| Block | Source Function | Content |
|---|---|---|
| `assignedWorkOrders` | `loadTaskBlocks()` | Work orders assigned to user |
| `overduePm` | `loadTaskBlocks()` | Overdue PM plans |
| `riskScores` | `loadRiskAndAnalytics()` | Risk scores for scoped assets |
| `reliabilityMetrics` | `loadRiskAndAnalytics()` | MTBF/MTTR/availability |
| `replacementPriority` | `loadRiskAndAnalytics()` | Replacement priority scores |
| `recommendationFlags` | `loadRiskAndAnalytics()` | Active recommendation flags |
| `decisionSupportQueue` | `loadRiskAndAnalytics()` | Triage queue |
| `lowStockParts` | `loadLogistics()` | Low-stock/stockout parts |
| `procurementPipeline` | `loadLogistics()` | Procurement requests |
| `trainingRequests` | `loadTaskBlocks()` | Training requests |
| `disposalPipeline` | `loadTaskBlocks()` | Disposal requests |

### Formal Tools (`planFormalTools` in `task-context-service.ts`)

| Tool | When Selected | Returns |
|---|---|---|
| `read_current_user_context` | Always | User profile context |
| `read_current_page_context` | Always | Page route, module, visible counts |
| `read_equipment_status` | `summarize_equipment`, `explain_equipment_risk` | Full asset record with analytics |
| `read_equipment_history` | When `equipmentId` present | Maintenance event history |
| `read_work_order_status` | `summarize_work_order` | Work order record |
| `read_command_center_snapshot` | `prioritize_tasks` | Critical actions, scores |
| `read_alerts_summary` | `prioritize_tasks`, `explain_equipment_risk`, `summarize_alerts` | Notification synthesis |
| `read_pm_compliance` | `prioritize_tasks`, `explain_pm_status` | PM compliance data |
| `read_calibration_status` | `prioritize_tasks`, `explain_pm_status`, Calibration module | Calibration due/overdue |
| `read_department_readiness` | `summarize_department_readiness` | Readiness snapshots |
| `read_stock_blockers` | `logistics_status` | Stock blockers with WO linkage |
| `read_procurement_pipeline` | `procurement_status` | Procurement pipeline |
| `read_training_status` | `training_status` | Training requests |
| `read_disposal_status` | `disposal_status` | Disposal pipeline |
| `read_replacement_risk` | `explain_equipment_risk` | Replacement priority data |
| `read_qr_asset_context` | `qr_asset_context` | QR-linked asset |
| `read_qr_scan_evidence` | `qr_asset_context` | QR scan history |
| `read_offline_sync_summary` | `offline_sync_status` | Sync queue/conflicts |
| `read_report_snapshot` | `report_summary` | Report page context |

## Critical Finding 1: Logistics Only Loads for 2 Intents

**File:** `context-service.ts` line 130

```typescript
if (intent === 'calibration_or_logistics' || intent === 'maintenance_tip') {
  // load spare_parts
}
```

The logistics snapshot only loads when the intent is `calibration_or_logistics` or `maintenance_tip`. This means a `prioritize_tasks` or `decision_support` query will not have stock data in the evidence, even though stock blockers affect prioritization.

**Fix:** Load logistics for all operational capabilities, or move stock data to the formal tool layer (which already has `read_stock_blockers`).

## Critical Finding 2: Analytics Snapshot Only for Specific Intents

**File:** `context-service.ts` line 149

```typescript
if (intent === 'analytics_explanation' || equipmentId) {
  // load risk/reliability/replacement scores
}
```

Department-level analytics (PM compliance, recommendation flags) only load when the intent is `analytics_explanation`. If the classifier routes to `dashboard_summary` or `decision_support` instead, the analytics snapshot is empty, and the department readiness answer lacks PM/flag data.

**Fix:** Load department analytics for all department-scoped capabilities.

## Critical Finding 3: Context Loads on `intentForEvidence` Mapping

**File:** `task-context-service.ts` lines 347-363

```typescript
const intentForEvidence =
  capability === 'logistics_status' ? 'calibration_or_logistics'
  : capability === 'procurement_status' ? 'calibration_or_logistics'
  : capability === 'safe_troubleshooting' ? 'troubleshooting'
  : ... : 'maintenance_tip';
```

This mapping converts capabilities back to intents for evidence loading. The default is `maintenance_tip`, which limits context loading for unmapped capabilities. This is an unnecessary translation layer — evidence loading should be capability-driven, not intent-driven.

## Critical Finding 4: Silent Failure on Missing Context

When `buildChatEvidence` queries fail or return empty, the system continues with empty evidence. The safety service then sees `hasEvidence = false` and either returns `limited_answer` with generic guidance or `check_manual`. The user has no idea their question failed because the context loader silently returned nothing.

**Fix:** Add explicit "missing data" flags to the response when expected context is absent.

## Target Asset Summary Context Packet

For an `asset_summary` capability, the context should include:

- `asset_code`, `name`, `department`, `category`
- `condition`, `status`, `criticality`
- `manufacturer`, `model` (if available)
- Open work orders count
- Recent maintenance requests
- PM status (compliance %, overdue?)
- Calibration status (next due, last result)
- Risk score/band (RPN, risk_level)
- Replacement review status (RPI, rank)
- Missing data flags

**Current gap:** Open work orders and recent maintenance requests are not always loaded for equipment summaries. The `read_equipment_status` formal tool returns them when available, but `buildChatEvidence` only loads `maintenanceHistory` from `maintenance_events`, not open work orders or requests.

## Files That Need Future Changes

1. **`context-service.ts`** — Remove intent-gating on logistics and analytics; load based on capability
2. **`task-context-service.ts`** — Replace `intentForEvidence` mapping with direct capability-based evidence config
3. **`tools/get-equipment-summary.ts`** — Ensure open work orders and requests are included
4. **`context-service.ts`** — Add missing data flags to ChatEvidence
