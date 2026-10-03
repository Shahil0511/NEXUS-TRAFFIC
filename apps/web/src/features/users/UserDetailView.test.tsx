import { ERROR_CODES, ROUTES } from '@nexus/shared';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { SESSION_ID, timelineItem, USER_KEY, USER_PROFILE } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { UserDetailView } from './UserDetailView';

function useProfileHandlers(profileStatus = 200): void {
  server.use(
    http.get(routeUrl(ROUTES.users.profile), () =>
      profileStatus === 200
        ? HttpResponse.json(USER_PROFILE)
        : HttpResponse.json(
            {
              error: {
                code: ERROR_CODES.NOT_FOUND,
                message: 'no activity for this user',
                requestId: 'req-7',
              },
            },
            { status: profileStatus },
          ),
    ),
    http.get(routeUrl(ROUTES.users.timeline), () =>
      HttpResponse.json({
        items: [
          timelineItem('t-api', 'api', { path: '/api/orders/123', ip: '203.0.113.7' }),
          timelineItem('t-page', 'page_view'),
          timelineItem('t-tool', 'tool_use', { sessionId: null }),
        ],
        nextCursor: null,
      }),
    ),
  );
}

describe('UserDetailView', () => {
  it('renders the profile: totals, top pages/tools and countries', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    expect(await screen.findByRole('heading', { name: 'buyer@libas.in' })).toBeInTheDocument();
    const metrics = screen.getByRole('region', { name: 'User metrics' });
    expect(within(metrics).getByText('1,234')).toBeInTheDocument();
    expect(within(metrics).getByText('1.0% of requests')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Top pages' })).toHaveTextContent('/orders/:id');
    expect(screen.getByRole('list', { name: 'Top tools' })).toHaveTextContent('export-csv');
    expect(screen.getByText('India')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view sessions/i }).getAttribute('href')).toBe(
      `/journeys?userKey=${USER_KEY}`,
    );
  });

  it('merges API calls, pages and tools in one timeline (IP only when sent, replay by id)', async () => {
    useProfileHandlers();
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    const table = await screen.findByRole('table', { name: 'User activity' });
    expect(await within(table).findByText('/api/orders/123')).toBeInTheDocument();
    expect(within(table).getByText('API call')).toBeInTheDocument();
    expect(within(table).getByText('Page view')).toBeInTheDocument();
    expect(within(table).getByText('1m 5s visible')).toBeInTheDocument();
    expect(within(table).getByText('export-csv')).toBeInTheDocument();
    expect(within(table).getAllByText('203.0.113.7')).toHaveLength(1);
    const replays = within(table).getAllByRole('link', { name: /replay/i });
    expect(replays).toHaveLength(2);
    expect(replays[0]?.getAttribute('href')).toBe(`/journeys/ebo-sales/${SESSION_ID}`);
  });

  it('shows the API error (404: no activity in the window)', async () => {
    useProfileHandlers(404);
    renderWithProviders(<UserDetailView userKey={USER_KEY} />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('no activity for this user')).toBeInTheDocument();
    expect(within(alert).getByText(/Request ID req-7/)).toBeInTheDocument();
  });
});
