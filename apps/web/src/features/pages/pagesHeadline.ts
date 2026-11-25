import type { PageStatsDto } from '@nexus/shared';

import type { SentencePart } from '@/components/HeadlineSentence';
import { countPhrase } from '@/lib/countPhrase';
import { formatDuration, formatInteger } from '@/lib/format';
import { PAGES, withQuery } from '@/lib/pages';

type LinkQuery = Readonly<Record<string, string | undefined>>;

/**
 * WHY: the pages people look at longest (median visible time), longest first; pages without a
 * measurement are skipped. Feeds the "People look longest at …" part of the Pages sentence.
 * Pure; never reorders its input.
 */
export function longestMedianPages(pages: readonly PageStatsDto[], limit = 1): PageStatsDto[] {
  return pages
    .filter((page) => page.p50VisibleMs !== null)
    .sort((a, b) => (b.p50VisibleMs ?? 0) - (a.p50VisibleMs ?? 0))
    .slice(0, limit);
}

/**
 * WHY: the pages most visits end on, most exits first; pages no visit ended on are skipped. Feeds
 * the "Most visits end on …" part of the Pages sentence. Pure; never reorders its input.
 */
export function topExitPages(pages: readonly PageStatsDto[], limit = 1): PageStatsDto[] {
  return pages
    .filter((page) => page.exits > 0)
    .sort((a, b) => b.exits - a.exits)
    .slice(0, limit);
}

/** A page's template as a bold link to its own page (carrying the page's filters). */
function pageLinkPart(page: PageStatsDto, linkQuery: LinkQuery): SentencePart {
  return {
    text: page.pathTemplate,
    href: withQuery(PAGES.pageDetail(page.app, page.pageId), linkQuery),
  };
}

/**
 * " People look longest at /orders/:id (median 31.00 s)." — or, when no page has a measured
 * visible time, that it appears once the browser tracker sends it.
 */
function longestParts(items: readonly PageStatsDto[], linkQuery: LinkQuery): SentencePart[] {
  const [longest] = longestMedianPages(items, 1);
  if (!longest) {
    return [" No visible time measured yet: it appears once the app's browser tracker sends it."];
  }
  return [
    ' People look longest at ',
    pageLinkPart(longest, linkQuery),
    ' (median ',
    { text: formatDuration(longest.p50VisibleMs) },
    ').',
  ];
}

/** " Most visits end on /orders/:id (50 visits)." — empty when no visit ended on a loaded page. */
function topExitParts(items: readonly PageStatsDto[], linkQuery: LinkQuery): SentencePart[] {
  const [top] = topExitPages(items, 1);
  if (!top) return [];
  return [
    ' Most visits end on ',
    pageLinkPart(top, linkQuery),
    ' (',
    { text: countPhrase(top.exits, 'visit', 'visits') },
    ').',
  ];
}

/**
 * "2 pages viewed 432 times in this range." — or, on a capped list (the API's top N by views),
 * "The 100 most viewed pages were viewed 4,200 times in this range.", so the counts read as a
 * bound and never as the range's total.
 */
function openingParts(count: number, views: number, capped: boolean): SentencePart[] {
  const viewed = { text: countPhrase(views, 'time', 'times') };
  if (capped) {
    return [
      'The ',
      { text: `${formatInteger(count)} most viewed pages` },
      ' were viewed ',
      viewed,
      ' in this range.',
    ];
  }
  return [{ text: countPhrase(count, 'page', 'pages') }, ' viewed ', viewed, ' in this range.'];
}

/**
 * WHY: the Pages list opens with its numbers in one sentence (PageHeader headline) instead of a
 * chart and a list above the table: how many pages were viewed how often, which page people look
 * at longest and which page most visits end on, each page a link to its own page. Counts are over
 * the loaded rows; `capped` (the list reached the API limit) words the opening as a bound.
 * Singulars handled ("1 page", "1 time", "1 visit"). Pure.
 */
export function pagesHeadline(
  items: readonly PageStatsDto[],
  linkQuery: LinkQuery,
  capped = false,
): SentencePart[] {
  if (items.length === 0) return ['No page was viewed in this range.'];
  const views = items.reduce((sum, page) => sum + page.views, 0);
  return [
    ...openingParts(items.length, views, capped),
    ...longestParts(items, linkQuery),
    ...topExitParts(items, linkQuery),
  ];
}
