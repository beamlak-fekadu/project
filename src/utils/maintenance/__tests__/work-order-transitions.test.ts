import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredCapabilityForWorkOrderTransition } from '@/utils/maintenance/work-order-transitions';
import { isOpenWorkOrderStatus, OPEN_WORK_ORDER_STATUSES } from '@/utils/maintenance/request-status';
import { hasCapability } from '@/lib/rbac';

// R18: every WO status transition maps to its own capability.

test('in_progress → work_order.start', () => {
  assert.equal(requiredCapabilityForWorkOrderTransition('in_progress'), 'work_order.start');
});

test('completed → work_order.complete', () => {
  assert.equal(requiredCapabilityForWorkOrderTransition('completed'), 'work_order.complete');
});

test('on_hold → work_order.hold', () => {
  assert.equal(requiredCapabilityForWorkOrderTransition('on_hold'), 'work_order.hold');
});

test('open / assigned / canceled → work_order.assign', () => {
  for (const status of ['open', 'assigned', 'canceled']) {
    assert.equal(
      requiredCapabilityForWorkOrderTransition(status),
      'work_order.assign',
      `${status} should require work_order.assign`,
    );
  }
});

test('no status change → work_order.add_event (generic edit baseline)', () => {
  assert.equal(requiredCapabilityForWorkOrderTransition(undefined), 'work_order.add_event');
});

test('unknown status returns null (action will reject)', () => {
  assert.equal(requiredCapabilityForWorkOrderTransition('lol_unknown'), null);
  assert.equal(requiredCapabilityForWorkOrderTransition(''), null);
});

// Cross-check with the capability matrix: a technician CAN complete (they have
// work_order.complete) but CANNOT cancel (they lack work_order.assign).
test('technician can complete but cannot cancel through the same gate', () => {
  const completeCap = requiredCapabilityForWorkOrderTransition('completed')!;
  const cancelCap = requiredCapabilityForWorkOrderTransition('canceled')!;
  assert.equal(hasCapability(['technician'], completeCap), true);
  assert.equal(hasCapability(['technician'], cancelCap), false);
});

// Cross-check: bme_head can do every transition we map.
test('bme_head can perform every mapped transition', () => {
  for (const status of ['in_progress', 'completed', 'on_hold', 'open', 'assigned', 'canceled']) {
    const cap = requiredCapabilityForWorkOrderTransition(status)!;
    assert.equal(
      hasCapability(['bme_head'], cap),
      true,
      `BME Head should be allowed for ${status} → ${cap}`,
    );
  }
});

// Cross-check: viewer fails every mapped transition.
test('viewer fails every mapped transition', () => {
  for (const status of ['in_progress', 'completed', 'on_hold', 'open', 'assigned', 'canceled']) {
    const cap = requiredCapabilityForWorkOrderTransition(status)!;
    assert.equal(
      hasCapability(['viewer'], cap),
      false,
      `viewer should be denied for ${status} → ${cap}`,
    );
  }
});

test('canonical open work-order statuses exclude completed and canceled', () => {
  assert.deepEqual([...OPEN_WORK_ORDER_STATUSES], ['open', 'assigned', 'in_progress', 'on_hold']);
  assert.equal(isOpenWorkOrderStatus('open'), true);
  assert.equal(isOpenWorkOrderStatus('completed'), false);
  assert.equal(isOpenWorkOrderStatus('canceled'), false);
  assert.equal(isOpenWorkOrderStatus('pending'), false);
});
