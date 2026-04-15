import { describe, expect, it } from 'vitest';

import { signJwt, verifyJwt } from '../auth.js';

describe('auth jwt', () => {
  it('signs and verifies payload', () => {
    const secret = 'test-secret';
    const token = signJwt({ userId: 'u1', email: 'a@b.com', role: 'admin' }, secret);
    const decoded = verifyJwt(token, secret);
    expect(decoded.userId).toBe('u1');
    expect(decoded.email).toBe('a@b.com');
    expect(decoded.role).toBe('admin');
  });
});
