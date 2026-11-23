'use client';

import { useIsFetching } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

/** What the page footer may honestly say about the content above it. */
export type PageEndStatus = 'loading' | 'more' | 'end';

interface OpenListRegistry {
  /** Lists on the page that can still load more rows. */
  openLists: number;
  /** Marks one list as open; the returned function unmarks it. */
  open: () => () => void;
}

const NO_REGISTRY: OpenListRegistry = { openLists: 0, open: () => () => undefined };
const OpenListContext = createContext<OpenListRegistry>(NO_REGISTRY);

/**
 * WHY: the page footer ("End of …") must not claim the page is over while a list above it still
 * has a "Load more". Lists report that here (useOpenListMarker in LoadMoreButton); the footer
 * reads it (usePageEndStatus). Mounted once by AppShell around the page and its footer.
 */
export function PageEndProvider({ children }: { children: ReactNode }) {
  const [openLists, setOpenLists] = useState(0);
  const open = useCallback(() => {
    setOpenLists((count) => count + 1);
    return () => setOpenLists((count) => count - 1);
  }, []);
  return (
    <OpenListContext.Provider value={{ openLists, open }}>{children}</OpenListContext.Provider>
  );
}

/** Marks the calling list as "more rows can be loaded" while `hasMore` is true. */
export function useOpenListMarker(hasMore: boolean): void {
  const { open } = useContext(OpenListContext);
  useEffect(() => (hasMore ? open() : undefined), [hasMore, open]);
}

/**
 * The footer's state: `loading` while any query of the page is on its FIRST load (skeletons are
 * showing; a background refetch keeps its data and does not count), `more` while a list can load
 * more rows, else `end`.
 */
export function usePageEndStatus(): PageEndStatus {
  const firstLoads = useIsFetching({ predicate: (query) => query.state.status === 'pending' });
  const { openLists } = useContext(OpenListContext);
  if (firstLoads > 0) return 'loading';
  return openLists > 0 ? 'more' : 'end';
}
