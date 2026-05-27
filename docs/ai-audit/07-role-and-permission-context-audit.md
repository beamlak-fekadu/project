# 07 — Role and Permission Context Audit

## Files: `copilot-rbac.ts`, `safety-service.ts`, `role-prompt-policy.ts`, `src/app/api/chat/route.ts`

---

## How User Role Is Passed Into Copilot

### Step 1: `getUserChatProfile()` in `src/app/api/chat/route.ts` (lines 15-57)

```typescript
const { data: userRoles } = await supabase
  .from('user_roles')
  .select('roles(name, permissions)')
  .eq('user_id', profile.id);

const roleNames = (userRoles ?? [])
  .map(row => row.roles?.name)
  .filter(Boolean) as string[];
```

All roles from `user_roles` table are loaded and passed as `roleNames: string[]`. If no roles found, defaults to `['viewer']`.

**Good:** All assigned roles are loaded, not just the primary role.

### Step 2: `getCopilotRoleCategory()` in `copilot-rbac.ts` (line 48)

```typescript
const ROLE_PRIORITY: RoleName[] = [
  'developer', 'admin', 'bme_head', 'technician',
  'store_user', 'department_head', 'department_user', 'viewer',
];

export function getCopilotRoleCategory(profile) {
  const roles = roleSet(profile);
  const selected = ROLE_PRIORITY.find(role => roles.has(role));
  return selected ?? 'unknown';
}
```

For multi-role users, the **highest-priority role wins**. A user with both `technician` and `department_user` gets `technician` category.

**Potential issue:** Department head with admin temp access gets `admin` behavior — this is correct by design but worth noting.

### Step 3: `buildCopilotRolePromptPolicy()` in `role-prompt-policy.ts`

Role policy defines `behavior` and `tone` per role category. These are injected into the Gemini prompt grounding context.

### Step 4: `evaluateSafetyDecision()` in `safety-service.ts`

RBAC checks use `profile.roleNames` directly (not the category) for intent/capability blocks.

---

## Role Names Used in Copilot

| Role Name | Used In | Notes |
|---|---|---|
| `developer` | `copilot-rbac.ts`, `safety-service.ts`, `role-prompt-policy.ts` | Full access, diagnostics |
| `admin` | `copilot-rbac.ts`, `safety-service.ts`, `role-prompt-policy.ts` | Operational + diagnostics |
| `bme_head` | `copilot-rbac.ts`, `safety-service.ts`, `role-prompt-policy.ts` | BME Head — full operational |
| `technician` | `copilot-rbac.ts`, `safety-service.ts`, `role-prompt-policy.ts` | Field technician |
| `store_user` | `copilot-rbac.ts`, `safety-service.ts`, `role-prompt-policy.ts` | Store/logistics |
| `department_head` | `copilot-rbac.ts`, `role-prompt-policy.ts` | Dept-scoped oversight |
| `department_user` | `copilot-rbac.ts`, `role-prompt-policy.ts` | Dept-scoped requester |
| `viewer` | `copilot-rbac.ts`, `role-prompt-policy.ts` | Read-only |

**Finding:** No old "engineer" role name appears in the copilot pipeline. The role model uses the correct Menilik-aligned names.

---

## Finding 1: No Old Demo Emails in Copilot Code

Searched across all copilot files — no hardcoded demo email addresses appear in:
- `copilot-rbac.ts`
- `safety-service.ts`
- `role-prompt-policy.ts`
- `classifier-service.ts`
- `context-service.ts`
- `assistant-orchestrator.ts`

The `src/utils/developer-lab/demo-role-validation.ts` and `src/scripts/setup-demo-users.ts` are utility scripts, not part of the live copilot pipeline.

**Good:** No hardcoded emails in the AI pipeline.

---

## Finding 2: Role Blocks Are Correct but Partially Confusing

**File:** `safety-service.ts` lines 23-34

```typescript
const ROLE_INTENT_BLOCKS: Record<string, ChatIntent[]> = {
  viewer: ['calibration_or_logistics', 'spare_parts_lookup', 'logistics_stock', 'procurement_status', 'calibration_status'],
  store_user: ['troubleshooting', 'safe_troubleshooting'],
};

const ROLE_CAPABILITY_BLOCKS: Record<string, CapabilityId[]> = {
  viewer: ['procurement_status', 'copilot_diagnostics'],
  store_user: ['safe_troubleshooting', 'copilot_diagnostics'],
  technician: ['copilot_diagnostics'],
  department_head: ['copilot_diagnostics'],
  department_user: ['copilot_diagnostics'],
};
```

**Observation:** `viewer` is blocked from `calibration_status` intent but NOT from `explain_pm_status` capability (which covers calibration). This could cause inconsistency: a viewer asking "which equipment needs calibration?" gets refused, but if the classifier routes to `explain_pm_status` instead, it proceeds.

---

## Finding 3: Missing Role Defaults Safely to Viewer

**File:** `src/app/api/chat/route.ts` line 50

```typescript
roleNames: roleNames.length ? roleNames : ['viewer'],
```

If no roles are found in `user_roles`, the profile defaults to `['viewer']`. This is safe — viewer gets read-only guidance.

---

## Finding 4: Department Scope Is Correctly Enforced

**File:** `copilot-rbac.ts` lines 83-96

`requiresDepartmentScope()` returns true for `department_head` and `department_user`. `canReadCopilotDepartment()` enforces that these roles can only see their own department.

`context-service.ts` uses `canSeeDepartment()` to filter equipment and work orders. This is correctly implemented.

---

## Finding 5: Role-Aware Prompting Works Well

`buildCopilotRolePromptPolicy()` produces distinct behavior/tone for each role:
- `developer`: diagnostic precision, raw metadata OK
- `bme_head`/`admin`: operational advisor, no raw traces
- `technician`: field assistant, short and action-first
- `store_user`: logistics focus
- `department_head`/`department_user`: dept-scoped, simple language
- `viewer`: executive read-only, no jargon

---

## Finding 6: No Permission Hallucination Risk in Current Code

The copilot does not look up permissions from the prompt or evidence to decide what actions are available. It uses the pre-loaded `profile.roleNames` throughout. The `canCreateCopilotDraft()` and `canExecuteCopilotAction()` checks in `action-draft-service.ts` use the same profile.

---

## Finding 7: Graceful Degradation on Profile Load Failure

If `getUserChatProfile()` returns `profile: null`, the API returns 401 Unauthorized. If the profile loads but `userRoles` is empty, defaults to viewer. The copilot degrades safely.

---

## Risk Summary

| Risk | Severity | Status |
|---|---|---|
| Old "engineer" role name in copilot | None | Not present ✓ |
| Hardcoded demo emails in copilot | None | Not present ✓ |
| Role defaults to unsafe on missing profile | None | Defaults to viewer ✓ |
| Department scope leakage | Low | Correctly enforced ✓ |
| Admin guidance shown to non-admins | Low | Role policy prevents this ✓ |
| `viewer` calibration intent vs capability inconsistency | Low | Needs review |
| `developer` role required for copilot_diagnostics | Correct | Enforced ✓ |

---

## Files That Need Future Changes

1. **`safety-service.ts`** — Align `ROLE_INTENT_BLOCKS` and `ROLE_CAPABILITY_BLOCKS` so viewer calibration blocking is consistent at both levels
2. **`copilot-rbac.ts`** — No changes needed; role model is correct
3. **`role-prompt-policy.ts`** — No changes needed; role policies are well-designed
