import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChatRequest } from '@/services/chatbot/classifier-service';
import { derivePageAwareCapability } from '@/services/chatbot/assistant-orchestrator';
import { COPILOT_ROLE_PAGE_FIXTURES } from '@/services/chatbot/evaluation/role-page-context-fixtures';

test('role/page-context fixtures route to expected capabilities', () => {
  const failures: string[] = [];

  for (const fixture of COPILOT_ROLE_PAGE_FIXTURES) {
    const classified = classifyChatRequest(fixture.prompt, fixture.memoryHint);
    const pageAware = derivePageAwareCapability({
      classified,
      message: fixture.prompt,
      moduleContext: fixture.moduleContext,
      contextRefs: fixture.contextRefs,
    });
    const actualCapability = pageAware ?? classified.capability;
    if (actualCapability !== fixture.expectedCapability) {
      failures.push(`${fixture.id}: expected ${fixture.expectedCapability}, got ${actualCapability}`);
    }
  }

  assert.deepEqual(failures, []);
});

test('known bad drift classes stay blocked at fixture level', () => {
  const summaryLike = COPILOT_ROLE_PAGE_FIXTURES.filter((fixture) =>
    ['asset-summary-technician', 'inventory-search-department-user', 'history-not-troubleshooting', 'command-center-summary', 'report-help-viewer'].includes(fixture.id)
  );

  for (const fixture of summaryLike) {
    const classified = classifyChatRequest(fixture.prompt, fixture.memoryHint);
    const pageAware = derivePageAwareCapability({
      classified,
      message: fixture.prompt,
      moduleContext: fixture.moduleContext,
      contextRefs: fixture.contextRefs,
    });
    assert.notEqual(pageAware ?? classified.capability, 'safe_troubleshooting', fixture.id);
  }

  for (const prompt of ['Hello', 'Can you help me?', 'Status']) {
    const classified = classifyChatRequest(prompt);
    assert.notEqual(classified.capability, 'maintenance_tips', prompt);
  }
});
