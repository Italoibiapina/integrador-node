import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export type UserRole = 'admin' | 'operator';

export type JwtUser = {
  userId: string;
  email: string;
  role: UserRole;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signJwt(payload: JwtUser, secret: string): string {
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '12h' });
}

export function verifyJwt(token: string, secret: string): JwtUser {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid token');
  }

  const userId = (decoded as Record<string, unknown>).userId;
  const email = (decoded as Record<string, unknown>).email;
  const role = (decoded as Record<string, unknown>).role;

  if (typeof userId !== 'string' || typeof email !== 'string') {
    throw new Error('Invalid token');
  }
  if (role !== 'admin' && role !== 'operator') {
    throw new Error('Invalid token');
  }

  return { userId, email, role };
}
