import { describe, expect, it } from 'vitest';

import { advisoryLockKey } from '../db.js';

describe('advisoryLockKey', () => {
  it('is deterministic', () => {
    const a = advisoryLockKey('step1.captureOrders', 'integration-1');
    const b = advisoryLockKey('step1.captureOrders', 'integration-1');
    expect(a).toBe(b);
  });

  it('changes for different inputs', () => {
    const a = advisoryLockKey('step1.captureOrders', 'integration-1');
    const b = advisoryLockKey('step2.sendOrders', 'integration-1');
    const c = advisoryLockKey('step1.captureOrders', 'integration-2');
    expect(a === b).toBe(false);
    expect(a === c).toBe(false);
  });
});
