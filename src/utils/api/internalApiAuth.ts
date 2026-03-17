import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export function validateAuth(req: IncomingMessage): boolean {
  const token = process.env.COGWORKS_INTERNAL_API_TOKEN || '';
  if (!token) return false;

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;

  const provided = header.slice(7);
  if (provided.length !== token.length) return false;

  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  } catch {
    return false;
  }
}
