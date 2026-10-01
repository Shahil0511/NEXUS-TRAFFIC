/**
 * Authenticates an ingest API key end to end (orchestrator — each step is its own unit):
 * parseApiKey → cache (prefix) → ApiKeyRepository.findByPrefix → ApiKeyHasher.matches →
 * not revoked / not expired → kind matches → AppRepository.findById → app active.
 *
 * Errors (uniform messages so callers learn nothing about which check failed):
 * - missing header                → 401 MISSING_API_KEY
 * - unknown/revoked/expired/bad   → 401 INVALID_API_KEY ('Invalid API key')
 * - wrong kind for the endpoint   → 403 WRONG_KEY_TYPE
 * - secret key where a publishable key is expected (browser endpoint)
 *                                 → api_keys.exposed_at is set, 403 SECRET_KEY_EXPOSED
 * - app missing                   → 401 INVALID_API_KEY
 * - app disabled                  → 403 APP_DISABLED
 *
 * Only fully valid results are cached; expiry and app.is_active are re-checked on every hit, and
 * the full key is always re-verified against the cached hash (the prefix alone is not a secret).
 * On success, `last_used_at` / `last_sdk` are updated fire-and-forget (failures are logged only).
 * @see ../repositories/api-key.repository.ts ApiKeyRepository.findByPrefix / markExposed / touchUsage
 * @see ../repositories/app.repository.ts AppRepository.findById
 */
import { ERROR_CODES, INGEST_LIMITS, type KeyKind } from '@nexus/shared';

import type { ApiKeyRow, AppRow } from '../domain/rows';
import type { AuthenticatedKey } from '../domain/viewer';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import type { AppRepository } from '../repositories/app.repository';
import type { ApiKeyHasher } from './api-key.hasher';
import { parseApiKey, type ParsedApiKey } from './api-key.parser';
import type { AppKeyCache } from './app-key.cache';

const INVALID_KEY_MESSAGE = 'Invalid API key';

function invalidKey(): UnauthorizedError {
  return new UnauthorizedError(INVALID_KEY_MESSAGE, ERROR_CODES.INVALID_API_KEY);
}

/** WHY: the single gate every ingest request passes; composes the small auth units in order. */
export class AppKeyAuthenticator {
  constructor(
    private readonly apiKeys: ApiKeyRepository,
    private readonly apps: AppRepository,
    private readonly hasher: ApiKeyHasher,
    private readonly cache: AppKeyCache,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** `sdk` (the X-Nexus-SDK header) is only recorded as api_keys.last_sdk. */
  async authenticate(
    rawKey: string | undefined,
    expected: KeyKind | 'any',
    sdk: string | null = null,
  ): Promise<AuthenticatedKey> {
    if (!rawKey) throw new UnauthorizedError('Missing API key', ERROR_CODES.MISSING_API_KEY);
    const parsed = parseApiKey(rawKey);
    if (!parsed) throw invalidKey();
    const cached = this.fromCache(parsed, rawKey);
    const key = cached?.key ?? (await this.loadKey(parsed, rawKey));
    this.assertUsable(key);
    await this.assertKind(key, expected);
    const app = cached?.app ?? (await this.loadApp(key.app_id));
    this.assertActive(app);
    if (!cached) this.cache.set(parsed.keyPrefix, { app, key });
    this.recordUsage(key, sdk);
    return { app, key };
  }

  /** A cache hit counts only if the full key matches the cached hash. */
  private fromCache(parsed: ParsedApiKey, rawKey: string): AuthenticatedKey | undefined {
    const hit = this.cache.get(parsed.keyPrefix);
    return hit && this.hasher.matches(rawKey, hit.key.key_hash) ? hit : undefined;
  }

  private async loadKey(parsed: ParsedApiKey, rawKey: string): Promise<ApiKeyRow> {
    const key = await this.apiKeys.findByPrefix(parsed.keyPrefix);
    if (!key || !this.hasher.matches(rawKey, key.key_hash)) throw invalidKey();
    return key;
  }

  private assertUsable(key: ApiKeyRow): void {
    if (key.revoked_at) throw invalidKey();
    if (key.expires_at && key.expires_at.getTime() <= this.clock.now().getTime()) throw invalidKey();
  }

  private async assertKind(key: ApiKeyRow, expected: KeyKind | 'any'): Promise<void> {
    if (expected === 'any' || key.kind === expected) return;
    if (expected === 'publishable' && key.kind === 'secret') {
      await this.apiKeys.markExposed(key.id);
      throw new ForbiddenError(
        'A secret key was sent to a browser endpoint; rotate it now',
        ERROR_CODES.SECRET_KEY_EXPOSED,
      );
    }
    throw new ForbiddenError(`This endpoint requires a ${expected} key`, ERROR_CODES.WRONG_KEY_TYPE);
  }

  private async loadApp(appId: string): Promise<AppRow> {
    const app = await this.apps.findById(appId);
    if (!app) throw invalidKey();
    return app;
  }

  private assertActive(app: AppRow): void {
    if (!app.is_active) throw new ForbiddenError('This app is disabled', ERROR_CODES.APP_DISABLED);
  }

  /** Fire-and-forget: a failed usage update must never fail ingest. */
  private recordUsage(key: ApiKeyRow, sdk: string | null): void {
    const label = sdk ? sdk.slice(0, INGEST_LIMITS.maxSdkNameLength) : null;
    void this.apiKeys
      .touchUsage(key.id, label)
      .catch((err: unknown) => this.logger.warn('api key usage update failed', { err, keyId: key.id }));
  }
}
