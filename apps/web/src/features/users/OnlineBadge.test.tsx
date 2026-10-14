import { ROUTES, type OnlineNowDto, type OnlineUserDto } from '@nexus/shared';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { qk } from '@/lib/query/keys';
import { USER_KEY } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { OnlineBadge } from './OnlineBadge';

function onlineUser(overrides: Partial<OnlineUserDto> = {}): OnlineUserDto {
  return {
    userKey: USER_KEY,
    email: 'buyer@libas.in',
    app: 'ebo-sales',
    sessionId: null,
    currentPage: '/orders',
    lastEvent: {
      kind: 'page_view',
      path: '/orders',
      tool: null,
      method: null,
      status: null,
      endpointId: null,
    },
    lastSeenAt: new Date().toISOString(),
    events: 3,
    ...overrides,
  };
}

function online(users: OnlineUserDto[]): OnlineNowDto {
  return {
    asOf: new Date().toISOString(),
    windowMs: 300_000,
    apps: users.map((user) => ({ app: user.app, users: 1, anonymous: 0 })),
    users,
  };
}

function useOnline(body: OnlineNowDto, seen: URLSearchParams[] = []) {
  server.use(
    http.get(routeUrl(ROUTES.live.online), ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json(body);
    }),
  );
  return seen;
}

describe('OnlineBadge', () => {
  it('says where the person is right now, asking for that person only', async () => {
    const seen = useOnline(online([onlineUser()]));
    renderWithProviders(<OnlineBadge userKey={USER_KEY} />, {
      searchParams: '?app=other&range=7d',
    });
    const badge = await screen.findByText(/Online now/);
    expect(badge).toHaveTextContent('Online now · in ebo-sales · on /orders');
    // Not app- or range-filtered: being online is a fact about the person.
    expect(seen[0]?.get('userKey')).toBe(USER_KEY);
    expect(seen[0]?.get('app')).toBeNull();
    expect(seen[0]?.get('range')).toBeNull();
  });

  it('names the most recent app and counts the others; no page for API-only activity', async () => {
    useOnline(
      online([
        onlineUser({ app: 'hr-portal', currentPage: null }),
        onlineUser({ app: 'ebo-sales' }),
      ]),
    );
    renderWithProviders(<OnlineBadge userKey={USER_KEY} />);
    const badge = await screen.findByText(/Online now/);
    expect(badge).toHaveTextContent('Online now · in hr-portal (+1 more app)');
    expect(badge).not.toHaveTextContent('· on');
  });

  it('renders nothing when the person is not active', async () => {
    useOnline(online([]));
    const { container, queryClient } = renderWithProviders(<OnlineBadge userKey={USER_KEY} />);
    // Wait for the ANSWER (not just the request), so "nothing" is the rendered result.
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(qk.live.online({ userKey: USER_KEY }))?.status).toBe(
        'success',
      ),
    );
    expect(container).toBeEmptyDOMElement();
  });
});
