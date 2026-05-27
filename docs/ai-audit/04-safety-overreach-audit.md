# 04 — Safety Overreach Audit

## This is the #1 suspected cause of bad responses.

## Where Safety Is Introduced

### 1. Global System Prompt (`prompt-service.ts` line 18-31)

```
CHATBOT_SYSTEM_PROMPT contains:
"For troubleshooting, provide safe first-line checks only. Never provide internal
board-level repair, alarm bypass, service mode, hidden-menu, firmware,
component-level, or manufacturer-specific calibration steps."
```

**PROBLEM:** This instruction is in the GLOBAL system prompt, not scoped to the troubleshooting capability. Every single Gemini call — including asset summaries, department readiness, report help — receives this troubleshooting instruction. Gemini interprets "provide safe first-line checks" as something it should always do, even when the user asked for a summary.

### 2. Classifier Troubleshooting Patterns (`classifier-service.ts` lines 256-271)

Broad patterns like `/\bfault\b/i`, `/\bfailure\b/i`, `/\bultrasound\b/i`, `/\bpatient monitor\b/i` steal status/summary questions into the troubleshooting intent. Once classified as troubleshooting, the entire pipeline shifts to safety mode.

### 3. Safety Service Always Limits Troubleshooting (`safety-service.ts` lines 398-409)

```typescript
if (intent === 'troubleshooting' || intent === 'calibration_or_logistics') {
  return {
    decision: 'limited_answer',  // ALWAYS limited, even with evidence
    answerBasis: hasManualSupport ? 'manual_or_sop' : 'general_safe_guidance',
    ...
  };
}
```

Any question classified as troubleshooting gets `limited_answer` decision regardless of evidence quality. This means even a well-grounded asset summary that accidentally hit the troubleshooting regex gets degraded.

### 4. Output Contract Requests All Fields (`prompt-service.ts` lines 216-246)

The `outputContract` in the prompt always includes:
- `troubleshooting_steps`
- `escalation_guidance`
- `escalation_recommendation`
- `likely_causes`
- `maintenance_tips`

This tells Gemini to populate troubleshooting fields for every response, even summaries.

### 5. Blocked Content Builder Adds Default Safe Checks (`assistant-orchestrator.ts` lines 278-347)

`buildBlockedAssistantContent()` adds a `defaultSafeChecks` array to blocked responses:
```typescript
const defaultSafeChecks = [
  'Confirm power source, plug, cable, battery, and accessories externally.',
  'Inspect for visible damage, overheating, blocked ventilation...',
  'Check current asset history, PM/calibration status...',
  'Remove from clinical use and escalate if alarms...',
];
```

These appear even in responses blocked for non-troubleshooting reasons (e.g., too_detailed or out_of_scope).

## Exact Lines Causing Overreach

| File | Lines | Problem |
|---|---|---|
| `prompt-service.ts` | 27 | "For troubleshooting, provide safe first-line checks only" in GLOBAL prompt |
| `prompt-service.ts` | 216-246 | `outputContract` always includes troubleshooting fields |
| `classifier-service.ts` | 256-271 | Overly broad troubleshooting patterns |
| `safety-service.ts` | 398-409 | `troubleshooting` intent always returns `limited_answer` |
| `assistant-orchestrator.ts` | 286-292 | Default safe checks in ALL blocked responses |
| `capability-registry.ts` | 15-22 | `ALL_SECTIONS` used for every capability |

## Safety Overreach Examples

### Example A: "Summarize ED-0002"

**Expected:** Factual asset summary only.

**What happens:**
1. Classifier may not match troubleshooting (depends on asset name)
2. BUT the global system prompt says "For troubleshooting, provide safe first-line checks only"
3. The output contract asks Gemini to fill `troubleshooting_steps`
4. Gemini generates: summary + unsolicited troubleshooting steps + escalation guidance
5. User sees: "ED-0002 is a defibrillator... Check power cables, verify accessories, escalate if unsafe"

### Example B: "What is the failure count for this monitor?"

**Expected:** Factual answer: "This monitor has had 3 failures in the last 12 months."

**What happens:**
1. Classifier matches `troubleshooting` (via `/\bfailure\b/i` and `/\bmonitor\b/i`)
2. Safety service returns `limited_answer` with `general_safe_guidance`
3. System prompt reinforces troubleshooting mode
4. Output: Generic safe first-line checks instead of the failure count

### Example C: "Which ultrasound units are in the ED?"

**Expected:** Inventory list of ultrasound equipment in ED.

**What happens:**
1. Classifier matches `troubleshooting` (via `/\bultrasound\b/i`)
2. Routes to `safe_troubleshooting` capability
3. Loads troubleshooting context instead of inventory data
4. Output: "Before troubleshooting the ultrasound, check power, probes, gel..."

## Recommended Safety-Mode Architecture

### Principle: Safety should be a guardrail, not the main answer style.

### Target safety modes:

| Mode | When | Behavior |
|---|---|---|
| `normal` | Most requests (summary, status, analytics, workflow) | No safety boilerplate. Facts only. |
| `bounded_troubleshooting` | User explicitly asks for troubleshooting help | Safe first-line checks + system context. No board-level. |
| `elevated` | High-criticality equipment + troubleshooting intent | Stronger escalation language, stricter bounds |
| `restricted` | Unsafe request detected | Refuse with safe alternative |
| `refuse` | Out of scope (clinical diagnosis, etc.) | Hard refuse |

### Key changes needed:

1. **Remove troubleshooting instructions from global system prompt.** Move them to a capability-specific addendum that only activates for `safe_troubleshooting` capability.

2. **Remove troubleshooting fields from outputContract for non-troubleshooting capabilities.** Use capability-specific output schemas.

3. **Stop `limited_answer` for troubleshooting when evidence is strong.** If there is equipment data, maintenance history, and PM status, allow `answer` decision.

4. **Narrow classifier patterns.** Remove `/\bfault\b/i`, `/\bfailure\b/i`, `/\bultrasound\b/i`, `/\bpatient monitor\b/i` from troubleshooting intent. These should only trigger troubleshooting when combined with action-oriented words like "check", "fix", "not working".

5. **Add explicit "Do NOT provide troubleshooting steps unless capability is safe_troubleshooting" to the system prompt.**

## Files That Need Future Changes

1. **`prompt-service.ts`** — Restructure system prompt to scope safety by capability
2. **`prompt-service.ts`** — Capability-specific output contracts
3. **`safety-service.ts`** — Allow `answer` for troubleshooting with strong evidence
4. **`classifier-service.ts`** — Narrow troubleshooting patterns
5. **`capability-registry.ts`** — Differentiate `responseSections`
6. **`assistant-orchestrator.ts`** — Remove default safe checks from non-troubleshooting blocked content
