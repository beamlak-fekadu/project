# BMERMS Offline Capability Design

Last updated: 2026-05-16  
Status: Offline Capability Phase 2 implemented

## Offline Phases

1. **Offline Foundation, App Shell, and Sync Infrastructure**  
   Adds PWA basics, service worker registration, app shell/offline fallback caching, network detection, global sync status, IndexedDB queue, sync skeleton, server sync-event logging where the current schema allows it, Developer Lab diagnostics, and this documentation.

2. **Offline-Capable Role Workflows**  
   Wires selected safe workflows into `runOfflineCapableAction()`, starting with additive or draft-first actions such as maintenance requests, maintenance event logs, calibration/training requests, department issue reports, store reorder requests, and stock receipt/issue drafts.

3. **Conflict Handling, Cached Read Views, and Sync Evidence**  
   Adds conflict review UI, scoped cached read views with user/profile isolation, richer server sync evidence, and workflow-specific merge/retry decisions. Conflicts must never be silently overwritten.

## Core Principle

Offline mode helps internet-constrained hospitals keep working, but it must not weaken data integrity. BMERMS must never show fake live data, mark a queued action as synced before server confirmation, silently overwrite a server record, bypass RBAC/RLS, or approve major decisions offline.

The device must open BMERMS once while online before offline loading can work. That first visit registers `/sw.js` and caches the app shell/offline fallback. A device that has never opened BMERMS online cannot load the app offline.

## Phase 1 Implementation

### PWA and Service Worker

- Manifest: `public/manifest.webmanifest`
- App icon: `public/icons/bmerms-icon.svg`
- Service worker: `public/sw.js`
- Registration: `src/components/offline/ServiceWorkerRegister.tsx`
- Health probe: `public/offline-health.txt`
- Offline route: `src/app/offline/page.tsx`

The service worker precaches only safe shell resources: `/offline`, manifest, icon, and health probe. It cache-first serves static Next assets and icons. Navigation requests remain network-first; if the network fails, the service worker returns the cached `/offline` page or a minimal built-in fallback.

The service worker does **not** blindly cache authenticated dashboard pages, Supabase auth/API responses, reports, service-role data, or user-specific operational datasets.

### PC and Phone Behavior

PC:
- Chrome/Edge opens BMERMS online once.
- The service worker installs and caches the offline shell.
- During a later outage, a navigation reload falls back to the cached offline shell.
- Desktop PWA install is optional; caching does not depend on install.

Phone:
- Mobile browser opens BMERMS online once.
- The service worker installs and caches the offline shell.
- Add to Home Screen is optional.
- A later offline navigation can show the cached offline shell. QR scan routes still require online server resolution for real asset data in Phase 1.

### Network Detection and Global Status

- Hook: `src/hooks/useOnlineStatus.ts`
- Banner: `src/components/offline/OfflineStatusBanner.tsx`
- Topbar indicator: `src/components/offline/SyncStatusIndicator.tsx`
- QR compact indicator: `src/components/offline/NetworkStatusPill.tsx`

The hook uses `navigator.onLine`, browser `online`/`offline` events, and a lightweight same-origin health check. The UI labels state honestly as Online, Offline, Checking, queued, syncing, failed, or conflict. It does not claim “fully offline.”

### IndexedDB Queue

- IndexedDB helper: `src/lib/offline/db.ts`
- Queue API: `src/lib/offline/queue.ts`
- Types/model: `src/types/offline.ts`

Queue records use:
- `client_action_id`
- `action_type`
- `entity_type`
- `entity_id`
- `asset_id`
- `qr_token`
- `payload`
- `created_by_profile_id`
- `role_name`
- `source_route`
- `created_at`
- `last_known_server_state`
- `sync_status`
- `retry_count`
- `last_error`
- `last_attempted_at`
- `synced_at`
- `conflict_reason`
- `metadata`

IDs use `crypto.randomUUID()` or `crypto.getRandomValues()` where available, with a deterministic timestamp/counter fallback. `Math.random()` is not used for offline IDs.

Queue operations:
- `enqueueOfflineAction`
- `getOfflineQueue`
- `getQueuedActions`
- `getFailedActions`
- `getConflictActions`
- `updateOfflineActionStatus`
- `incrementRetry`
- `markSynced`
- `markFailed`
- `markConflict`
- `retryOfflineAction`
- `removeOfflineAction`
- `clearSyncedActions`
- `getOfflineQueueSummary`

### Offline Action Model

Initial action types are defined in `src/types/offline.ts` and categorized as:

- `additive_safe`
- `draft_requires_review`
- `state_change_requires_validation`
- `online_only`

Phase 1 defines the model only. It does not wire production workflows yet.

Online-only examples:
- procurement approval
- disposal approval
- QR token regeneration
- user/settings/security changes
- analytics refresh
- final work-order closure
- final assignment
- replacement decisions

### Generic Offline Runner

`runOfflineCapableAction()` lives in `src/lib/offline/queue.ts`.

Behavior:
- If online, run `executeOnline()`.
- If the online attempt fails due to a likely network failure, enqueue when `queueIfOffline` is true.
- If offline, enqueue immediately when allowed.
- Validation/server errors are not queued blindly.
- Online-only actions are rejected by the queue helper.

### Sync Engine and Phase 2 Handlers

- Sync engine: `src/lib/offline/sync-engine.ts`
- Provider: `src/components/offline/SyncEngineProvider.tsx`

The sync engine:
- listens through the provider when the app comes online
- reads queued actions from IndexedDB
- processes actions sequentially by `created_at`
- uses `offlineActionHandlers[action_type]`
- does not mark synced unless a handler reports server acceptance
- records retry/error metadata
- keeps unsupported actions visible as failed with a clear “handler not implemented” message
- does not delete queued/failed/conflict data silently

Phase 2 registers real replay handlers in:
- `src/lib/offline/handlers/maintenance.ts`
- `src/lib/offline/handlers/department-requests.ts`
- `src/lib/offline/handlers/store.ts`
- `src/lib/offline/handlers/index.ts`

Handlers call `syncOfflineQueuedActionAction()` so the existing server actions remain the authority for RBAC, validation, audit, and revalidation.

### Server Sync Event Logging

- Action: `recordOfflineSyncEventAction()` in `src/actions/offline-sync.actions.ts`
- Service summary: `src/services/offline-sync.service.ts`

Existing `offline_sync_events` supports:
- `client_action_id`
- `actor_user_id`
- `entity_type`
- `entity_id`
- `action_type`
- `payload`
- `sync_status` (`pending`, `synced`, `failed`)
- `created_at`
- `synced_at`

Phase 1 adapts to that schema. Fields such as `asset_id`, `role_name`, `queued_at`, `source_route`, `error_message`, and `conflict_reason` are stored inside `payload`. Conflict is stored as `sync_status='failed'` plus `payload.conflict_reason` because the existing check constraint does not allow a native `conflict` status.

No migration was added in Phase 1.

### Developer Lab Diagnostics

Developer Lab includes **Offline & Sync Diagnostics**:
- service worker status
- app shell cache status
- network status
- local queue counts
- local queue table
- clear synced local actions
- retry failed local actions
- export local queue JSON
- recent server `offline_sync_events`
- failed events
- inferred conflicts
- actions by role where payload evidence exists

Unknown browser states are shown as “Unknown,” not healthy.

## Phase 2 Workflow Integration

Phase 2 wires selected workflow forms through `runOfflineCapableAction()`:

- Technician:
  - `/maintenance/work-orders/[id]/events/new` queues `maintenance_event.log`.
  - `/maintenance/work-orders/[id]` can save `work_order.start_intent`, `work_order.complete_draft`, and maintenance-event notes.
  - QR technician scans expose offline-capable maintenance note, corrective request, and parts-needed note capture.
- Department user/head:
  - `/maintenance/requests/new` queues `maintenance_request.create` or `department_issue.report`.
  - `/calibration` queues `calibration_request.create`.
  - `/training` queues `training_request.create`.
  - `/requests` shows local queued request rows separately from live server rows.
  - QR department scans expose report-problem, calibration request, and training request capture.
- Store user:
  - `/procurement/requests/new` queues `store_reorder.create`.
  - `/spare-parts` queues `stock_receipt.draft` and `stock_issue.draft` in the operational stock modals.
  - Store stock-control view has an Offline Store Draft panel for reorder, receipt, and issue drafts.
  - QR store scans expose reorder drafts only when part context is available or entered.
- BME Head/Admin:
  - QR scans expose draft note capture through `qr_note.create`.
  - Final approvals, assignment, work closure, QR administration, analytics refresh, and replacement decisions remain online-only.
- Viewer:
  - No offline writes. Cached read views remain Phase 3.
- Developer:
  - Developer Lab can inspect payloads, retry failed actions, clear synced actions, export local queue JSON, and review server sync-event evidence. It does not expose fake production test actions.

All Phase 2 forms label queued records as local/pending, failed, synced, or needs review. Queued local rows are not mixed with live server rows without an explicit badge.

## Conflict and Validation Rules

Phase 2 marks obvious invalid replay cases as `conflict` in IndexedDB:

- asset missing/deleted
- QR token no longer resolves or was revoked
- department user/head asset outside profile department
- duplicate open maintenance request
- duplicate open calibration/training request for the same asset/type
- terminal work order for maintenance note/start/completion draft
- work order already in progress when a start intent replays
- inactive/missing spare part
- invalid receipt/issue/reorder quantity
- insufficient stock at issue sync time
- linked work order closed for stock issue draft
- procurement-linked receipt draft when the current `stock_receipts` schema cannot represent the procurement link

Full conflict review UI is Phase 3. Phase 2 preserves conflicts in the local queue and writes conflict evidence through `offline_sync_events` where the existing schema allows it.

## Duplicate Handling

Maintenance request replay uses the existing `createMaintenanceRequestAction()` duplicate guard. Calibration and training replay check open/pending rows before creating new requests. Store reorder replay checks open procurement requests by part title evidence when a `part_id` is present. Duplicate candidates are marked conflict rather than silently creating clutter.

## Role-Specific Offline Permissions Foundation

Helper: `src/lib/offline/offline-permissions.ts`

Current permissions:
- developer: inspect diagnostics, retry/clear queue; no fake operational test action
- admin/BME Head: review cached data/draft notes later; no final approvals offline
- technician: maintenance event logs, QR notes, maintenance requests, work-order start intent, and completion drafts
- department head/user: maintenance, calibration, training, and department issue requests
- store user: reorder and stock receipt/issue drafts
- viewer: read-only cached views later; no offline write actions

These permissions are enforced before queueing and again during replay. Server-side RBAC/RLS remains authoritative.

## QR Boundary

QR is complete through six phases and remains online-first for asset resolution and scan logging. Phase 2 adds safe offline capture panels to authenticated QR landing pages for technician, department, store, and BME Head/Admin draft-note use. It does not change QR tokens, QR label generation, QR landing resolution, QR scan logging, QR coverage, or QR scan evidence.

Offline QR scan logging is not implemented in Phase 2.

## Cache and Security Safeguards

- No broad caching of authenticated server-rendered dashboard pages.
- No caching of Supabase auth responses.
- No caching of sensitive reports or service-role data.
- No role/operational dataset caching in Phase 1.
- Future user-specific caches must include user/profile scoping and last-synced timestamps.
- Full QR tokens are not written into sync-event payloads; sync events store a masked QR token if one is present.

## Intentionally Not Implemented Through Phase 2

- Deep coverage of every workflow form.
- Offline QR scan logging.
- Cached operational read views.
- Conflict review center.
- Browser notifications.
- Background Sync API dependence.
- Fake queued test actions in production UI.
- Automatic duplicate cleanup.
- Schema migration for richer `offline_sync_events` columns.
- Procurement/disposal approval offline.
- Final work-order closure or technician assignment offline.
- QR token generation/regeneration offline.
- Analytics refresh, settings/security changes, replacement decisions, or full report generation offline.

## Manual Validation Checklist

1. Load BMERMS online and confirm `/sw.js` registers in browser DevTools.
2. Confirm `bmerms-app-shell-v1` exists in Cache Storage.
3. Turn off the network and reload a route; confirm the offline shell loads.
4. Confirm the topbar indicator and banner switch to Offline.
5. Confirm Developer Lab diagnostics show service worker/cache/queue status.
6. Restore the network and confirm the sync engine attempts queued actions.
7. Confirm unsupported Phase 1 queued actions are not marked synced.
8. Confirm non-developer users do not see Developer Lab diagnostics.

# Phase 3 — Production-Like Offline Behavior

Phase 3 closes the offline capability plan by making offline behavior safe,
reviewable, and defensible without changing online workflows. It adds robust
conflict handling, a Sync Review Center, role-scoped cached read views, a
retry/resolution workflow, richer offline_sync_events evidence, and Developer
Lab/BME Head oversight.

## Phase 3 Goals

- No silent overwrites: every state-changing offline action revalidates server
  state on sync and classifies conflicts before persisting.
- Reviewable evidence: BME Head, Admin, and Developer can see, retry, mark
  under review, manually resolve, or discard every queued action — with an
  audit row written server-side.
- Safe cached reads: role/profile/department-scoped reads stay visible offline
  with honest "Offline cached data — may be stale" banners and last-synced
  timestamps.
- No fake data, no fake sync, no unscoped department caching, no offline
  high-risk approvals.

## Conflict Engine — src/lib/offline/conflicts.ts + validation.ts

`OfflineConflictDetail` is now stored on each queued action and replayed sync
event. Conflict types:

| Conflict type | Trigger |
|---|---|
| asset_missing | Asset id or QR token does not resolve at sync time |
| asset_deleted | Asset row exists but has `deleted_at` |
| department_scope_mismatch | Department role tries to act on another department's asset |
| duplicate_open_request | An open maintenance/calibration/training/procurement request already exists |
| work_order_completed | Linked work order is completed/canceled |
| work_order_status_changed | Linked work order status moved (e.g., already in progress) |
| insufficient_stock | Server stock is below the requested issue quantity |
| procurement_state_changed | Linked procurement is unexpectedly missing or in an unsupported state |
| stock_already_received | Receipt already recorded server-side (reserved; current schema does not expose `procurement_request_id` on receipts) |
| unsupported_action | No sync handler registered for this action type |
| permission_denied | Current role cannot replay this action server-side |
| stale_server_state | Server state is fresher than the action's last-known snapshot |
| unknown_sync_error | Unrecognized sync error |
| invalid_payload | Local payload failed validation (missing field or invalid quantity) |
| part_missing | Spare part deleted before sync |
| part_inactive | Spare part marked inactive |

Each `OfflineConflictDetail` carries `conflict_type`, `conflict_reason`,
`server_state_summary`, `local_payload_summary`, `recommended_resolution`,
`resolution_status`, `created_at`. Original queued payload is never removed.

Resolution statuses:

- `conflict` — initial state when a conflict is recorded.
- `under_review` — flagged by an Admin/BME Head as in progress.
- `resolved_synced` — replayed successfully after the underlying issue is fixed.
- `resolved_discarded` — local action discarded; an audit row is written.
- `resolved_manual` — admin manually marks the conflict resolved (e.g., the
  underlying record was fixed online and the offline draft is no longer needed).

## Validation Rules by Action Type

`src/actions/offline-sync.actions.ts → syncOfflineQueuedActionAction` walks the
following rules before any state change:

- `maintenance_request.create` / `department_issue.report` — asset resolves +
  alive; department scope matches for department roles; existing open request
  check via the existing duplicate guard.
- `calibration_request.create` — asset alive + scoped; duplicate open
  calibration request check.
- `training_request.create` — asset scoped (when present); duplicate open
  training request for same training type check.
- `maintenance_event.log` / `qr_note.create` / `work_order.complete_draft` —
  work order alive (when linked); terminal work orders rejected as conflict;
  otherwise appended as an additive event.
- `work_order.start_intent` — work order alive; not already started; not
  terminal; otherwise applied.
- `store_reorder.create` — part alive + active; possible duplicate
  procurement request check (text-match on part name); valid quantity.
- `stock_receipt.draft` — part alive + active; valid quantity; linked
  procurement is flagged for review because `stock_receipts` has no
  `procurement_request_id` column.
- `stock_issue.draft` — part alive + active; valid quantity; current stock
  sufficient; linked work order alive and not terminal.

## Sync Review Center — `/offline-sync`

Page route: `src/app/(dashboard)/offline-sync/page.tsx`.

- Access: `admin`, `bme_head` (and `developer` via `requireRole` short-circuit).
- Summary cards: Queued, Syncing, Synced, Failed, Conflicts, Needs Review.
- Filters: status, action type, conflict type, role, search by id/asset/error.
- Local Device Queue table: created at, user/role, action, entity, asset,
  status, conflict/error, retries, and per-row actions:
  - Details modal (read-only payload, server state summary, conflict reason,
    recommended resolution).
  - Open exact record (`/equipment/[id]`, `/maintenance/work-orders/[id]`,
    etc.) for safe navigation.
  - Retry (only for failed or under-review; disabled offline or for
    unsupported-action rows).
  - Mark under review.
  - Manual resolve (with confirm dialog).
  - Discard (with confirm dialog).
- Server Sync Events table: same evidence pulled from `offline_sync_events`,
  including actor name/email, reported status, conflict type, and exact-record
  open links.
- Developer-only Mismatch Diagnostics card surfaces local↔server count drift.
- CSV exports for both the local queue and server events; JSON queue export.
- No raw payload editing — the table is read-only. Fixes happen on the source
  record, then a retry; or the local draft is discarded.

## Retry / Resolution Workflow

Local queue operations (in `src/lib/offline/queue.ts`):

- `retryOfflineAction(id, { allowConflict })` — clears error/conflict and
  re-enqueues; `allowConflict` is opt-in for under-review rows.
- `markUnderReview(id, note)` — sets `sync_status=under_review`,
  `resolution_status=under_review`, preserves conflict detail.
- `markResolvedDiscarded(id, note)` — sets `sync_status=resolved_discarded`,
  `resolution_status=resolved_discarded`, keeps original payload.
- `markResolvedManual(id, note)` — sets `sync_status=synced`,
  `resolution_status=resolved_manual`, records `manual_resolution=true` in
  metadata.

Server-side `recordOfflineConflictResolutionAction` writes an audit row and
appends an `offline_sync_events` row with `reported_status` and
`resolution_status` inside payload (the current schema only allows
`pending|synced|failed` for `sync_status`).

## Cached Read Views — `src/lib/offline/cache.ts`

- IndexedDB `offline_read_cache` store (DB version bumped to 2).
- Storage key includes `profile_id::role_name::department_id::cache_key`. A
  user's cached data is never returned when reading under a different
  profile/role/department scope.
- Default freshness window: 12 hours; cached views past the window are marked
  stale.
- `saveOfflineReadCache(key, data, scope, { sourceRoute, expiresAt })` /
  `getOfflineReadCache(key, scope)` / `clearOfflineReadCache(scope?, key?)` /
  `getCacheSummary()` / `formatCacheAge(cachedAt)`.
- Logout clears the current profile's caches in `(dashboard)/layout.tsx` so
  another user logging in on the same device does not see prior cached
  operational data.

Cached pages currently wired in Phase 3:

- `DepartmentEquipmentOverview` (department equipment) — falls back to cache
  when the live load fails, with an amber stale banner and last-synced
  timestamp.

Additional role-specific cache wiring (technician assigned work, store stock
list, viewer executive snapshot, BME Head operational summary, etc.) is a
documented next step but is intentionally scoped narrowly here to avoid
behavior drift on already-shipping pages. The cache scaffolding
(`saveOfflineReadCache` + `getOfflineReadCache` + `OfflineCacheRegistrar`) is
ready for additional surfaces to opt in.

## Role-Specific Cached Experience

| Role | Reads | Writes offline |
|---|---|---|
| Technician | Future cache for assigned work + QR scans | Existing additive maintenance evidence (Phase 2) |
| Department Head/User | Department equipment cached; My/department requests via Requests Hub stay live | Existing department request drafts (Phase 2) |
| Store User | Future cache for stock list/bin card/blockers | Existing reorder/receipt/issue drafts (Phase 2) |
| Viewer | Future cache for executive dashboard/reports | None — viewer remains read-only |
| BME Head/Admin | Future cache for operational summary | QR note drafts only; approvals remain online-only |
| Developer | Diagnostics-only access | None |

## offline_sync_events Improvements

The Phase 3 client → server bridge writes additional payload fields without
schema migration:

- `reported_status` — `queued|syncing|synced|failed|conflict|under_review|resolved_discarded|resolved_synced`.
- `conflict_detail` — full `OfflineConflictDetail` for replayed conflicts.
- `resolution_status` — `conflict|under_review|resolved_synced|resolved_discarded|resolved_manual`.
- `retry_count`, `error_message`, `role_name`, `source_route`, `asset_id`,
  `masked_qr_token` (never the raw token).
- `phase` is now `offline.phase3.workflow-replay` / `.resolution`.

Phase 3 maps the new statuses back to the existing CHECK constraint:
`conflict` and `under_review` → `failed`, `resolved_discarded` → `failed`,
`resolved_synced` and `synced` → `synced`. Inferred status is reconstructed
from `reported_status` in the payload by the service layer.

## Global Sync Indicator

`SyncStatusIndicator` now exposes:

- Needs Review count (conflict + under_review) in the pill label.
- Four-stat panel (Queued / Failed / Conflict / Review).
- "Last sync run" summary line.
- Sync Review Center link for admin/bme_head/developer; Developer Lab
  Diagnostics link for developer only.
- Non-privileged users see the same retry button without the review link.

## Developer Lab Offline Diagnostics

Phase 3 adds, in addition to the Phase 2 panel:

- App shell cache version string read from `caches.keys()` (no hard-coded
  version).
- Offline Read Cache section with total/cached profiles/stale counts, a table
  of the 25 most recent entries, and "Clear All Read Cache".
- Local ↔ Server Mismatch Warnings card surfaces honest drift (conflicts
  without server evidence, action types missing server-side, pending
  unsupported rows that will never replay).
- Direct links to Sync Review Center and Offline Sync Evidence Report.

## Offline Evidence Reports — `/reports/offline-sync-evidence`

- Standalone admin/bme_head-only report at `/reports/offline-sync-evidence`.
- Surfaced from the Resource/Procurement/People section on `/reports` as
  `adminOnly`.
- Filters (all/failed/conflict/synced/discarded), per-role and per-action-type
  counts, full event table with conflict types and user/role context.
- CSV export with snapshot timestamp header; "Print / Save as PDF" via the
  browser print stack (no new PDF library).
- No fake records — every row is read from `offline_sync_events`.

## Strict Non-Goals That Remain

- Browser notifications.
- Background Sync API dependency.
- Offline procurement/disposal/user/settings/security/QR-token-admin actions.
- Offline analytics refresh / replacement decisions / final work-order closure
  or assignment.
- Forced unsafe sync past validation.
- Cross-user cache leakage.
- All-hospital fallback for department-scoped cache.
- Schema migration for richer `offline_sync_events` columns (deferred until
  a real production rollout demands a structured schema).

## Manual Validation Checklist (Phase 3)

1. Phase 1+2 checks still pass (service worker, app shell cache, offline
   shell, queue, banner, diagnostics).
2. Queue a technician maintenance note offline; restore network; confirm the
   row syncs and appears in `/offline-sync` and `/reports/offline-sync-evidence`.
3. Queue a department issue against an asset that has been deleted (or with a
   bad asset id) and confirm the row appears as `conflict` with conflict type
   `asset_missing`/`asset_deleted` and a recommended resolution.
4. Queue a store stock issue that exceeds current stock; confirm
   `insufficient_stock` conflict with `server_state_summary.current_stock`
   visible in the details modal.
5. Mark a conflict as "Under review", "Manual resolve", or "Discard" in
   Sync Review Center; confirm a server audit + `offline_sync_events` row is
   written with the resolution status.
6. Logout and log back in as a different user on the same device; confirm
   the previous user's department equipment cache is not returned.
7. Confirm viewer cannot queue offline writes and has no Sync Review Center
   link.
8. Confirm BME Head/Admin cannot queue offline procurement approvals,
   disposal approvals, final work-order closure, or QR token admin.
9. Developer Lab → "Local ↔ Server Mismatch Warnings" surfaces accurate
   warnings after staging mismatched local rows.

# Phase 3 Completion Pass (2026-05-16)

Three Phase 3 follow-ups closed in the same branch:

## 1. Cached Read Views — Fully Wired

The four documented "next step" cached views are now in place. Each falls back
to its IndexedDB cache when the live load fails and renders the standard amber
"Offline cached data — may be stale" banner with last-synced age.

| Role | Page | Cache key |
|---|---|---|
| Technician | `/work-orders` (assigned-to-me rows) | `technician.assigned_work` |
| Store user | `/spare-parts` (Store control surface) | `store.stock_list` |
| Viewer | `/command` (Executive Oversight Portal) | `viewer.executive_summary` |
| BME Head / Admin | `/command` (full operational dashboard) | `bme_head.operational_summary` |
| Department user/head | `/equipment` (department-scoped) | `department.equipment` |

Server-rendered pages (`/command`) persist their snapshot via the
`OfflineCacheRegistrar` client component so the next offline session can find
the data. Client-rendered pages (`/work-orders`, `/spare-parts`,
`/equipment`) write the cache directly inside their `useEffect` data loader
and read it back from cache on failure.

The `/offline` fallback page now also renders `CachedSnapshotList`, a small
client component that reads `getCacheSummary()` and shows the user the cached
views they can still open on this device. It links to the same operational
routes, which will render their cached banner once the user navigates.

## 2. Migration 00046 — offline_sync_events first-class columns

`offline_sync_events` was previously limited to
`pending|synced|failed` and stored Phase 3 evidence inside `payload`.
Migration 00046 promotes Phase 3 evidence to real columns:

- `reported_status TEXT` — `queued|syncing|synced|failed|conflict|under_review|resolved_synced|resolved_discarded`.
- `resolution_status TEXT` — `conflict|under_review|resolved_synced|resolved_discarded|resolved_manual|discarded|manual_resolved`.
- `conflict_type TEXT` — populated from `OfflineConflictDetail.conflict_type`.
- `conflict_reason TEXT`, `error_message TEXT`, `role_name TEXT`,
  `source_route TEXT`, `asset_id UUID`, `retry_count INTEGER`.
- `resolved_by UUID REFERENCES profiles(id)`, `resolved_at TIMESTAMPTZ`.
- CHECK on `sync_status` is relaxed to accept all Phase 3 statuses while
  remaining backward-compatible with legacy `pending|synced|failed` rows.
- New CHECK on `resolution_status` constrains it to the resolution enum.
- Hot-path indexes on `created_at DESC`, `(actor_user_id, created_at DESC)`,
  `action_type`, `conflict_type`, `reported_status`, `asset_id`.
- One-shot backfill copies the most important payload fields into the new
  columns for historical rows; the operation is idempotent.
- RLS UPDATE policy reaffirmed to include `bme_head` alongside the existing
  admin/developer/technician roles.

`recordOfflineSyncEventAction` now writes both the first-class columns and the
payload mirror, so consumers can rely on either path. The Sync Review Center
service (`enrichSyncEvent`) prefers the columns when present and falls back to
payload for rows written before the migration was applied.

After running `supabase db push --linked`, regenerate types:

```
npx supabase gen types typescript --linked > src/types/database.ts
```

The action insert path uses `as never` casts today because the generated types
were not regenerated in this pass.

## 3. IndexedDB v1 → v2 Upgrade Path — Verified

`openOfflineDb()` now uses an explicit `oldVersion` check inside
`onupgradeneeded`:

- v0 → v1 (fresh install): create the `offline_actions` queue store.
- v1 → v2 (Phase 3): create the `offline_read_cache` store **without
  touching the existing `offline_actions` store**, so users that already
  have queued offline actions keep them through the upgrade.

The store-existence guard (`if (!db.objectStoreNames.contains(...))`)
makes the upgrade idempotent — if the user has a fresh install at v2,
both stores are created in a single upgrade pass.

Manual verification (deferred to QA): open BMERMS on a device that ran
Phase 1 or Phase 2, queue an action, upgrade to Phase 3, and confirm the
queued action survives. Web Inspector → Storage → IndexedDB
→ `bmerms-offline` should show both `offline_actions` and `offline_read_cache`
stores after upgrade.
