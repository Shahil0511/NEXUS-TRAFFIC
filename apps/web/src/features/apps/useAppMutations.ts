'use client';

import {
  ERROR_CODES,
  type CreateAppBody,
  type CreateKeyBody,
  type ExpireKeyBody,
  type UpdateAppBody,
  type UpdateSdkConfigBody,
} from '@nexus/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { ApiError } from '@/lib/apiError';
import { qk } from '@/lib/query/keys';

/**
 * WHY: the admin writes of the Apps page, one hook per ROUTES.apps leaf. Every call goes through
 * `request()` (X-Nexus-Dashboard: 1 — the API's CSRF guard — and the SSO cookie); on success the
 * app list (`qk.apps.all`, also the global App filter) and the Integration page
 * (`qk.integration.all`: exposed keys) are refetched. Chain: api.apps.<leaf> → ROUTES.apps.<leaf> →
 * AppController.<leaf> → AppAdminService.<leaf> (audited).
 */
function useInvalidateApps() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.apps.all }),
      queryClient.invalidateQueries({ queryKey: qk.integration.all }),
    ]);
}

export function useCreateApp() {
  const invalidate = useInvalidateApps();
  return useMutation({
    mutationFn: (body: CreateAppBody) => api.apps.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateApp() {
  const invalidate = useInvalidateApps();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: UpdateAppBody }) =>
      api.apps.update(slug, body),
    onSuccess: invalidate,
  });
}

/**
 * The response holds the ONLY copy of the new key's plaintext. `gcTime: 0` drops the finished
 * mutation from React Query's cache at once; the reveal dialog keeps it in component state until
 * it closes. NEVER log it, put it in a URL or persist it.
 */
export function useCreateKey() {
  const invalidate = useInvalidateApps();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: CreateKeyBody }) =>
      api.apps.createKey(slug, body),
    onSuccess: invalidate,
    gcTime: 0,
  });
}

export function useExpireKey() {
  const invalidate = useInvalidateApps();
  return useMutation({
    mutationFn: ({ slug, keyId, body }: { slug: string; keyId: string; body: ExpireKeyBody }) =>
      api.apps.expireKey(slug, keyId, body),
    onSuccess: invalidate,
  });
}

export function useRevokeKey() {
  const invalidate = useInvalidateApps();
  return useMutation({
    mutationFn: ({ slug, keyId }: { slug: string; keyId: string }) =>
      api.apps.revokeKey(slug, keyId),
    onSuccess: invalidate,
  });
}

/**
 * Remote SDK config (ADR 0009). On success the list refetches (the card shows the new version);
 * a 409 CONFLICT (someone else saved first) also refetches, so reopening the dialog starts from
 * the current version instead of failing again.
 */
export function useUpdateSdkConfig() {
  const invalidate = useInvalidateApps();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: UpdateSdkConfigBody }) =>
      api.apps.updateSdkConfig(slug, body),
    onSuccess: invalidate,
    onError: (error) => {
      if (error instanceof ApiError && error.code === ERROR_CODES.CONFLICT) void invalidate();
    },
  });
}
