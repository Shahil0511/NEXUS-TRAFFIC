/**
 * Read side of app management: the Apps page list (apps + their keys, no secrets).
 */
import type { AppDto } from '@nexus/shared';

import { notImplemented } from '../lib/not-implemented';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import type { AppRepository } from '../repositories/app.repository';

export class AppQueryService {
  constructor(
    private readonly apps: AppRepository,
    private readonly apiKeys: ApiKeyRepository,
  ) {}

  /** @see ../repositories/app.repository.ts AppRepository.list, ApiKeyRepository.listByAppIds */
  async list(): Promise<AppDto[]> {
    void this.apps;
    void this.apiKeys;
    throw notImplemented('AppQueryService.list');
  }
}
