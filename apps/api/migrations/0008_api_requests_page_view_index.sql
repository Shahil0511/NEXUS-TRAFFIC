-- intent: serve the `page_view_id IN (subquery)` probe of a page's API calls (listPageApiCalls)
--         and the page-view linking KPI (ADR 0013). Partial: most API calls carry no page view.
--         Created on the partitioned parent, so every existing and future monthly partition gets
--         it. In its own file because the build scans each partition (no CONCURRENTLY: the runner
--         wraps every file in a transaction).

CREATE INDEX idx_api_requests_page_view_id
  ON traffic.api_requests (page_view_id)
  WHERE page_view_id IS NOT NULL;
