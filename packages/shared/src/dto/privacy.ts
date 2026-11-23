import type { PersonAccessSurface } from '../constants/traffic';

/**
 * GET ROUTES.privacy.accessLog item (CursorPage, newest first): one admin opening one part of one
 * person's page. The person is named by a MASKED email only (`s***@libas.in`, computed by the API
 * when the row is written); `subjectUserKey` opens their page (PAGES.userDetail).
 */
export interface PersonAccessEntryDto {
  id: number;
  viewedAt: string;
  /** The admin who opened the page. */
  viewerEmail: string;
  subjectUserKey: string;
  subjectEmailMasked: string;
  surface: PersonAccessSurface;
}
