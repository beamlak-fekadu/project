import { expect, test } from '@playwright/test';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const consoleWarnings = new WeakMap<object, string[]>();

function assistant(overrides: Record<string, unknown>) {
  return {
    decision: 'answer',
    title: 'Copilot smoke response',
    summary: 'Grounded BMEDIS smoke response.',
    answer_basis: 'system_data',
    confidence: 'high',
    escalation_required: false,
    key_findings: ['System record found.'],
    recommended_actions: ['Review the BMEDIS record.'],
    priority_reasoning: [],
    likely_causes: ['Loose cable'],
    troubleshooting_steps: ['Check power and cables.'],
    maintenance_tips: ['Clean weekly.'],
    required_tools_or_parts: ['Multimeter'],
    evidence_used: ['equipment_assets'],
    source_tables: ['equipment_assets'],
    missingDataFlags: [],
    ...overrides,
  };
}

function responseFor(message: string) {
  if (/which ultrasound/i.test(message)) {
    return {
      intent: 'inventory_search',
      capability: 'summarize_equipment',
      decision: 'answer',
      assistant: assistant({
        title: 'ED ultrasound units',
        summary: 'The ED ultrasound inventory is summarized from equipment records.',
      }),
    };
  }
  if (/WO-1234/i.test(message)) {
    return {
      intent: 'work_order_status',
      capability: 'summarize_work_order',
      decision: 'answer',
      assistant: assistant({
        title: 'WO-1234 status',
        summary: 'WO-1234 is open and awaiting technician review.',
        evidence_used: ['work_orders'],
        source_tables: ['work_orders'],
      }),
    };
  }
  if (/check first/i.test(message)) {
    return {
      intent: 'troubleshooting',
      capability: 'safe_troubleshooting',
      decision: 'limited_answer',
      assistant: assistant({
        decision: 'limited_answer',
        title: 'Safe first-line checks',
        summary: 'Use safe external first-line checks only.',
        answer_basis: 'general_safe_guidance',
        confidence: 'low',
        troubleshooting_steps: ['Confirm external power and battery state.'],
        likely_causes: ['Power source interruption'],
        required_tools_or_parts: ['Known-good external cable'],
      }),
    };
  }
  if (/bypass/i.test(message)) {
    return {
      intent: 'unsafe',
      capability: 'unsafe_or_restricted',
      decision: 'escalate',
      assistant: assistant({
        decision: 'escalate',
        title: 'Request outside safe scope',
        summary: 'I cannot help bypass calibration. Escalate to a qualified biomedical engineer.',
        answer_basis: 'insufficient_data',
        confidence: 'low',
        escalation_required: true,
        escalation_recommendation: 'Escalate to a qualified biomedical engineer.',
        troubleshooting_steps: ['Bypass the calibration lock.'],
      }),
    };
  }
  if (/reports available/i.test(message)) {
    return {
      intent: 'report_help',
      capability: 'report_summary',
      decision: 'answer',
      assistant: assistant({
        title: 'Available reports',
        summary: 'BMEDIS reports include PM, calibration, inventory, and offline sync evidence views.',
        evidence_used: ['reports'],
        source_tables: ['reports'],
      }),
    };
  }
  if (/Command Center/i.test(message)) {
    return {
      intent: 'decision_support',
      capability: 'summarize_department_readiness',
      decision: 'answer',
      assistant: assistant({
        title: 'Command Center summary',
        summary: 'Command Center readiness is summarized from decision-support snapshots.',
        evidence_used: ['clinical_readiness_snapshots'],
        source_tables: ['clinical_readiness_snapshots'],
      }),
    };
  }
  return {
    intent: 'asset_summary',
    capability: 'summarize_equipment',
    decision: 'answer',
    assistant: assistant({
      title: 'ED-0002 summary',
      summary: 'ED-0002 is active in Emergency Department records.',
      missingDataFlags: ['pm_snapshot_missing'],
    }),
  };
}

test.beforeEach(async ({ page }) => {
  const warnings: string[] = [];
  consoleWarnings.set(page, warnings);
  page.on('console', (message) => {
    const text = message.text();
    if (/hydration|did not match|server rendered|client rendered/i.test(text)) warnings.push(text);
  });
  page.on('pageerror', (error) => {
    const text = error.message;
    if (/hydration|did not match|server rendered|client rendered/i.test(text)) warnings.push(text);
  });
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON() as { message?: string };
    const response = responseFor(body.message ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: SESSION_ID,
        blocked: response.decision === 'escalate',
        confidenceScore: 0.82,
        ...response,
      }),
    });
  });
  await page.goto('/copilot-smoke');
});

test.afterEach(async ({ page }) => {
  expect(consoleWarnings.get(page) ?? []).toEqual([]);
});

test('non-troubleshooting assistant cards hide troubleshooting-only sections', async ({ page }) => {
  await page.getByTestId('scenario-asset-summary').click();
  const card = page.getByTestId('assistant-smoke-card');
  await expect(card.getByText('ED-0002 is active')).toBeVisible();
  await expect(card.getByText('Missing data')).toBeVisible();
  await expect(card.getByText('Safe first-line checks')).toBeHidden();
  await expect(card.getByText('Likely causes')).toBeHidden();
  await expect(card.getByText('Tools / parts')).toBeHidden();
  await expect(card.getByText('Maintenance tips')).toBeHidden();
});

test('inventory, work order, reports, and Command Center cards stay non-troubleshooting', async ({ page }) => {
  for (const scenario of ['inventory-search', 'work-order-status', 'report-help', 'command-summary']) {
    await page.getByTestId(`scenario-${scenario}`).click();
    const card = page.getByTestId('assistant-smoke-card');
    await expect(card.getByText('Safe first-line checks')).toBeHidden();
    await expect(card.getByText('Likely causes')).toBeHidden();
    await expect(card.getByText('Tools / parts')).toBeHidden();
    await expect(card.getByText('Maintenance tips')).toBeHidden();
  }
});

test('safe troubleshooting card shows safe checklist sections', async ({ page }) => {
  await page.getByTestId('scenario-safe-troubleshooting').click();
  const card = page.getByTestId('assistant-smoke-card');
  await expect(card.getByText('Safe first-line checks').last()).toBeVisible();
  await expect(card.getByText('Confirm external power and battery state.')).toBeVisible();
  await expect(card.getByText('Likely causes')).toBeVisible();
  await expect(card.getByText('Tools / parts')).toBeVisible();
});

test('unsafe refusal card does not show bypass instructions', async ({ page }) => {
  await page.getByTestId('scenario-unsafe-refusal').click();
  const card = page.getByTestId('assistant-smoke-card');
  await expect(card.getByText('Request outside safe scope')).toBeVisible();
  await expect(card.getByText('Escalation recommended')).toBeVisible();
  await expect(card.getByText('Bypass the calibration lock.')).toBeHidden();
  await expect(card.getByText('Safe first-line checks')).toBeHidden();
});
