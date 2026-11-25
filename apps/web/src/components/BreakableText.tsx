import { Fragment } from 'react';

/** A break is allowed after each of these: path slashes and the dots, dashes and underscores of names. */
const SEPARATOR = /(?<=[/._-])/;

/**
 * WHY: paths (/leaderboard/regions) and feature names (filters.date.financial-year) have no spaces,
 * so a narrow cell either overflows or, with break-all, splits mid-word ("/leaderboar d/regions").
 * A <wbr> after each separator lets the browser wrap only at a separator; a part that still does
 * not fit is left to the cell's overflow-wrap. The text itself (copy, search, title) is unchanged.
 * Some name computations read a <wbr> as a space, so a link that wraps it states its name with
 * aria-label (PageLink, ToolLink).
 */
export function BreakableText({ text }: { text: string }) {
  const parts = text.split(SEPARATOR);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? <wbr /> : null}
        </Fragment>
      ))}
    </>
  );
}
