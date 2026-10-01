/**
 * Test-only HS256 signer for the portal `access_token` (mirrors what the portal issues).
 */
import { createHmac } from 'node:crypto';

/** WHY: middleware tests need real, verifiable tokens without a dependency on a JWT library. */
export function signAccessToken(
  payload: Record<string, unknown>,
  secret: string,
  alg = 'HS256',
): string {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
