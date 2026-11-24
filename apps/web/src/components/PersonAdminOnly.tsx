'use client';

import { ERROR_CODES } from '@nexus/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { AdminOnly } from '@/components/AdminOnly';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Button } from '@/components/ui/button';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { ApiError } from '@/lib/apiError';
import { PAGES, withQuery } from '@/lib/pages';

const HTTP_FORBIDDEN = 403;

/** What the admins-only state names: a person's page (default) or the steps of one visit. */
export interface PersonAdminOnlyProps {
  /** Page title; defaults to "Person". */
  title?: string;
  /** Trail above the title; defaults to People › Person. */
  eyebrow?: ReactNode;
  /** The state's heading; defaults to the person-page sentence. */
  heading?: string;
  /** Why it is admins-only, one or two sentences; defaults to the person-page text. */
  description?: string;
}

/**
 * What a viewer who is not an admin sees instead of a person's page (or a verified person's visit
 * steps): the reason in plain words and the way back to the People list (open to every viewer).
 * WHY in components/: both the person page and the visit page show it (ADR 0015, ADR 0017).
 * @see ../features/users/UserDetailView.tsx
 * @see ../features/journeys/SessionDetailView.tsx
 */
export function PersonAdminOnly({
  title = 'Person',
  eyebrow,
  heading = "Only admins can open a person's page",
  description = "A person's page shows one person's daily activity, devices and visits, so only dashboard admins can open it. The People list stays open to you.",
}: PersonAdminOnlyProps = {}) {
  const { filters } = useGlobalFilters();
  const usersHref = withQuery(PAGES.users(), filterLinkQuery(filters));
  return (
    <AdminOnly
      title={title}
      eyebrow={
        eyebrow ?? (
          <Breadcrumbs items={[{ label: 'People', href: usersHref }, { label: 'Person' }]} />
        )
      }
      heading={heading}
      description={description}
      hint={null}
      action={
        <Button asChild variant="outline">
          <Link href={usersHref}>Back to People</Link>
        </Button>
      }
    />
  );
}

/** Whether the API refused the read for this viewer (403 FORBIDDEN: not an admin). Pure. */
export function isForbidden(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === HTTP_FORBIDDEN &&
    error.code === ERROR_CODES.FORBIDDEN
  );
}
