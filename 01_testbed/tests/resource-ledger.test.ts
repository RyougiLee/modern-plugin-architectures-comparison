import assert from 'node:assert/strict';
import test from 'node:test';

import { ResourceLedger } from '../shared/resource-ledger.js';

test('resource ledger tracks subscriptions by owner and releases idempotently', () => {
  const ledger = new ResourceLedger();
  const disposeFirst = ledger.registerSubscription('plugin-1');
  const disposeSecond = ledger.registerSubscription('plugin-1');

  assert.equal(ledger.countForOwner('plugin-1'), 2);
  assert.deepEqual(ledger.snapshot(), {
    activeSubscriptions: 2,
    totalActiveResources: 2,
    owners: [
      {
        ownerId: 'plugin-1',
        activeSubscriptions: 2,
        totalActiveResources: 2,
      },
    ],
  });

  disposeFirst();
  disposeFirst();
  disposeSecond();
  ledger.assertOwnerCount('plugin-1', 0);
  ledger.assertEmpty();
});
