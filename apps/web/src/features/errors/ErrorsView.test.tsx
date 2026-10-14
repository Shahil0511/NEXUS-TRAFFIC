import { ROUTES } from '@nexus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { ERROR_SUMMARY, failedRequest } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { ErrorsView } from './ErrorsView';

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const NEXT_CURSOR = 'cursor-after-first';

/** Two pages: the first carries a nextCursor, the second ends the list. */
function useErrorHandlers(): URLSearchParams[] {
  const listCalls: URLSearchParams[] = [];
  server.use(
    http.get(routeUrl(ROUTES.errors.summary), () => HttpResponse.json(ERROR_SUMMARY)),
    http.get(routeUrl(ROUTES.errors.list), ({ request }) => {
      const params = new URL(request.url).searchParams;
      listCalls.push(params);
      return params.get('cursor') === NEXT_CURSOR
        ? HttpResponse.json({ items: [failedRequest(SECOND_ID, 404)], nextCursor: null })
        : HttpResponse.json({ items: [failedRequest(FIRST_ID, 500)], nextCursor: NEXT_CURSOR });
    }),
  );
  return listCalls;
}

describe('ErrorsView', () => {
  it('renders totals and the first page of failed requests (IP shown when the API sent it)', async () => {
    useErrorHandlers();
    renderWithProviders(<ErrorsView />);
    const totals = await screen.findByRole('region', { name: 'Failure totals' });
    expect(await within(totals).findByText('15')).toBeInTheDocument();
    expect(await screen.findByText(`req-${FIRST_ID.slice(0, 4)}`)).toBeInTheDocument();
    expect(screen.getByText(/203\.0\.113\.7/)).toBeInTheDocument();
    // The concrete path is text, never a link.
    expect(screen.queryByRole('link', { name: '/api/orders/123' })).not.toBeInTheDocument();
  });

  it('"Load more" fetches the next page with the cursor and appends it', async () => {
    const listCalls = useErrorHandlers();
    const user = userEvent.setup();
    renderWithProviders(<ErrorsView />);
    await screen.findByText(`req-${FIRST_ID.slice(0, 4)}`);
    expect(listCalls[0]?.get('cursor')).toBeNull();

    await user.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByText(`req-${SECOND_ID.slice(0, 4)}`)).toBeInTheDocument();
    expect(screen.getByText(`req-${FIRST_ID.slice(0, 4)}`)).toBeInTheDocument();
    expect(listCalls.at(-1)?.get('cursor')).toBe(NEXT_CURSOR);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/end of list/)).toBeInTheDocument();
  });

  it('filters by status class and by the endpoint from the URL', async () => {
    const listCalls = useErrorHandlers();
    const user = userEvent.setup();
    renderWithProviders(<ErrorsView />, {
      searchParams: '?endpointId=6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11',
    });
    await screen.findByText(`req-${FIRST_ID.slice(0, 4)}`);
    expect(listCalls[0]?.get('endpointId')).toBe('6f1c3f7e-2a59-5a7e-9a51-0d6d3f3c1a11');

    await user.click(screen.getByRole('radio', { name: 'Server errors (5xx)' }));
    await waitFor(() => expect(listCalls.at(-1)?.get('statusClass')).toBe('5xx'));
  });

  it('counts the users affected and lists them, each linking to the user', async () => {
    useErrorHandlers();
    renderWithProviders(<ErrorsView />);
    const totals = await screen.findByRole('region', { name: 'Failure totals' });
    expect(await within(totals).findByText('4')).toBeInTheDocument();
    const affected = await screen.findByRole('list', { name: 'Most affected users' });
    expect(within(affected).getByRole('link', { name: 'buyer@libas.in' })).toBeInTheDocument();
  });

  it('?userKey= scopes the summary AND the list to one user, named in its chip', async () => {
    const listCalls = useErrorHandlers();
    const summaryCalls: URLSearchParams[] = [];
    server.use(
      http.get(routeUrl(ROUTES.errors.summary), ({ request }) => {
        summaryCalls.push(new URL(request.url).searchParams);
        return HttpResponse.json(ERROR_SUMMARY);
      }),
    );
    const key = 'a'.repeat(64);
    renderWithProviders(<ErrorsView />, { searchParams: `?userKey=${key}` });
    expect(
      await screen.findByRole('button', { name: 'Remove user filter User: buyer@libas.in' }),
    ).toBeInTheDocument();
    expect(summaryCalls.every((params) => params.get('userKey') === key)).toBe(true);
    await waitFor(() => expect(listCalls[0]?.get('userKey')).toBe(key));
  });

  it('a click on an error code scopes the summary AND the list, named in a removable chip', async () => {
    const listCalls = useErrorHandlers();
    const summaryCalls: URLSearchParams[] = [];
    server.use(
      http.get(routeUrl(ROUTES.errors.summary), ({ request }) => {
        summaryCalls.push(new URL(request.url).searchParams);
        return HttpResponse.json(ERROR_SUMMARY);
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ErrorsView />);
    const codes = await screen.findByRole('list', { name: 'Error codes' });
    // "No code sent" is listed (counts add up) but is not a filter.
    expect(within(codes).getByText('No code sent')).toBeInTheDocument();
    expect(within(codes).getAllByRole('button')).toHaveLength(2);

    await user.click(
      within(codes).getByRole('button', { name: /^QUERY_TIMEOUT: 9 failed, 2 routes/ }),
    );
    const chip = await screen.findByRole('button', {
      name: 'Remove error code filter Code: QUERY_TIMEOUT',
    });
    await waitFor(() => expect(listCalls.at(-1)?.get('errorCode')).toBe('QUERY_TIMEOUT'));
    await waitFor(() => expect(summaryCalls.at(-1)?.get('errorCode')).toBe('QUERY_TIMEOUT'));
    expect(
      within(codes).getByRole('button', { name: /^QUERY_TIMEOUT/, pressed: true }),
    ).toBeInTheDocument();

    // Removing the chip returns to the unscoped page (served from the cache of the first load).
    await user.click(chip);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Remove error code filter/ }),
      ).not.toBeInTheDocument(),
    );
    // The chip unmounted with focus on it: focus lands on the panel heading, not <body>.
    expect(screen.getByRole('heading', { name: 'Failed requests', level: 2 })).toHaveFocus();
    expect(
      within(codes).getByRole('button', { name: /^QUERY_TIMEOUT/, pressed: false }),
    ).toBeInTheDocument();
  });

  it('a click on the selected code in the panel toggles the scope off', async () => {
    useErrorHandlers();
    const user = userEvent.setup();
    renderWithProviders(<ErrorsView />, { searchParams: '?errorCode=QUERY_TIMEOUT' });
    const codes = await screen.findByRole('list', { name: 'Error codes' });
    await user.click(within(codes).getByRole('button', { name: /^QUERY_TIMEOUT/, pressed: true }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Remove error code filter/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it('?errorCode= from the URL scopes the summary AND the list (a shareable link)', async () => {
    const listCalls = useErrorHandlers();
    const summaryCalls: URLSearchParams[] = [];
    server.use(
      http.get(routeUrl(ROUTES.errors.summary), ({ request }) => {
        summaryCalls.push(new URL(request.url).searchParams);
        return HttpResponse.json(ERROR_SUMMARY);
      }),
    );
    renderWithProviders(<ErrorsView />, { searchParams: '?errorCode=SERVICE_UNAVAILABLE' });
    expect(
      await screen.findByRole('button', {
        name: 'Remove error code filter Code: SERVICE_UNAVAILABLE',
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(listCalls[0]?.get('errorCode')).toBe('SERVICE_UNAVAILABLE'));
    await waitFor(() => expect(summaryCalls[0]?.get('errorCode')).toBe('SERVICE_UNAVAILABLE'));
  });

  it('ignores a hand-edited, invalid ?errorCode= (falls back to every code, no 400)', async () => {
    const listCalls = useErrorHandlers();
    renderWithProviders(<ErrorsView />, { searchParams: '?errorCode=drop%20table' });
    await screen.findByText(`req-${FIRST_ID.slice(0, 4)}`);
    expect(listCalls[0]?.get('errorCode')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Remove error code filter/ }),
    ).not.toBeInTheDocument();
  });
});
