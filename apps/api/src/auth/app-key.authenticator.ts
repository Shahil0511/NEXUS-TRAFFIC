/**
 * Authenticates an ingest API key end to end (orchestrator — each step is its own unit):
 * parseApiKey → cache → ApiKeyRepository.findByPrefix → ApiKeyHasher.matches →
 * not revoked / not expired → kind matches → AppRepository.findById → app active.
 *
 * Errors (uniform messages so callers learn nothing about which check failed):
 * - missing header                → 401 MISSING_API_KEY
 * - unknown/revoked/expired/bad   → 401 INVALID_API_KEY
 * - wrong kind for the endpoint   → 403 WRONG_KEY_TYPE (secret on browser endpoint → caller maps to SECRET_KEY_EXPOSED)
 * - app disabled                  → 403 APP_DISABLED
 */
import type { KeyKind } from '@nexus/shared';

import type { AuthenticatedKey } from '../domain/viewer';
import type { Clock } from '../lib/clock';
import { notImplemented } from '../lib/not-implemented';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import type { AppRepository } from '../repositories/app.repository';
import type { ApiKeyHasher } from './api-key.hasher';
import type { AppKeyCache } from './app-key.cache';

export class AppKeyAuthenticator {
  constructor(
    private readonly apiKeys: ApiKeyRepository,
    private readonly apps: AppRepository,
    private readonly hasher: ApiKeyHasher,
    private readonly cache: AppKeyCache,
    private readonly clock: Clock,
  ) {}

  async authenticate(rawKey: string | undefined, expected: KeyKind | 'any'): Promise<AuthenticatedKey> {
    void rawKey;
    void expected;
    void this.apiKeys;
    void this.apps;
    void this.hasher;
    void this.cache;
    void this.clock;
    throw notImplemented('AppKeyAuthenticator.authenticate');
  }
}
