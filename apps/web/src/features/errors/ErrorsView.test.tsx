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
});
