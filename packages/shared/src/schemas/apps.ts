/**
 * Admin schemas for registering apps and managing their API keys (ROUTES.apps.*).
 */
import { z } from 'zod';

import { KEY_KIND_VALUES } from '../constants/keys';
import { appSlugSchema } from './common';

/** An origin like https://nexus.libas.in or http://localhost:3000 — scheme + host [+ port], no path. */
export const originSchema = z
  .string()
  .max(200)
  .regex(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i, 'must be an origin like https://host[:port]');

/** e.g. /ebo-sales — browser events must have paths under it. */
export const basePathSchema = z
  .string()
  .max(100)
  .regex(/^\/[a-z0-9/_-]*[a-z0-9_-]$/i, 'must look like /my-app');

export const appSlugParamsSchema = z.object({ slug: appSlugSchema });
export type AppSlugParams = z.infer<typeof appSlugParamsSchema>;

export const appKeyParamsSchema = z.object({ slug: appSlugSchema, keyId: z.uuid() });
export type AppKeyParams = z.infer<typeof appKeyParamsSchema>;

export const createAppBodySchema = z.object({
  slug: appSlugSchema,
  displayName: z.string().trim().min(1).max(100),
  basePath: basePathSchema.nullable().default(null),
  allowedOrigins: z.array(originSchema).max(20).default([]),
  browserIngestEnabled: z.boolean().default(true),
});
export type CreateAppBody = z.infer<typeof createAppBodySchema>;

export const updateAppBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    basePath: basePathSchema.nullable(),
    allowedOrigins: z.array(originSchema).max(20),
    browserIngestEnabled: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'nothing to update' });
export type UpdateAppBody = z.infer<typeof updateAppBodySchema>;

export const createKeyBodySchema = z.object({
  kind: z.enum(KEY_KIND_VALUES),
  label: z.string().trim().min(1).max(100),
});
export type CreateKeyBody = z.infer<typeof createKeyBodySchema>;

/** Rotation: create a new key, then expire the old one at a future grace time. */
export const expireKeyBodySchema = z.object({
  expiresAt: z.iso.datetime({ offset: true }),
});
export type ExpireKeyBody = z.infer<typeof expireKeyBodySchema>;
