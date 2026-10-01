/**
 * Data access for `traffic.apps`.
 * @see ../../migrations/0002_apps_and_api_keys.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import type { AppPatch, NewApp } from '../domain/inserts';
import type { AppRow } from '../domain/rows';
import { notImplemented } from '../lib/not-implemented';

export class AppRepository {
  constructor(private readonly db: Pool) {}

  async findById(id: string, exec: Executor = this.db): Promise<AppRow | null> {
    void id;
    void exec;
    throw notImplemented('AppRepository.findById');
  }

  async findBySlug(slug: string, exec: Executor = this.db): Promise<AppRow | null> {
    void slug;
    void exec;
    throw notImplemented('AppRepository.findBySlug');
  }

  /** All apps ordered by slug. */
  async list(exec: Executor = this.db): Promise<AppRow[]> {
    void exec;
    throw notImplemented('AppRepository.list');
  }

  /** Throws a unique-violation (23505) when the slug exists — the service maps it to 409. */
  async insert(app: NewApp, exec: Executor = this.db): Promise<AppRow> {
    void app;
    void exec;
    throw notImplemented('AppRepository.insert');
  }

  /** Applies only the provided fields; returns null when the app does not exist. */
  async update(id: string, patch: AppPatch, exec: Executor = this.db): Promise<AppRow | null> {
    void id;
    void patch;
    void exec;
    throw notImplemented('AppRepository.update');
  }
}
