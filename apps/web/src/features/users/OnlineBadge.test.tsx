import { ROUTES, type OnlineNowDto, type OnlineUserDto } from '@nexus/shared';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { qk } from '@/lib/query/keys';
import { USER_KEY } from '@/test/fixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { OnlineBadge, onlineSentence, otherAppsLabel } from './OnlineBadge';

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
    // One sentence for screen readers, every space and the app name in place.
    expect(
      await screen.findByText('Online now · in ebo-sales · on /orders', { selector: '.sr-only' }),
    ).toBeInTheDocument();
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
    const sentence = await screen.findByText(/^Online now/, { selector: '.sr-only' });
    expect(sentence).toHaveTextContent(/^Online now · in hr-portal \(\+1 more app\)$/);
  });

  it('draws the visual parts as separate, spaced pieces hidden from screen readers', async () => {
    useOnline(online([onlineUser()]));
    renderWithProviders(<OnlineBadge userKey={USER_KEY} />);
    const app = await screen.findByText('ebo-sales');
    const visual = app.parentElement!;
    expect(visual).toHaveAttribute('aria-hidden', 'true');
    expect(visual).toHaveClass('gap-x-1');
    // "in" and the app name are separate items, so the gap always spaces them.
    expect(app.previousElementSibling).toHaveTextContent(/^in$/);
  });

  it('builds the sentence with every space in place', () => {
    expect(onlineSentence('nexus-portal', 0, null)).toBe('Online now · in nexus-portal');
    expect(onlineSentence('ebo-sales', 2, '/orders')).toBe(
      'Online now · in ebo-sales (+2 more apps) · on /orders',
    );
    expect(otherAppsLabel(0)).toBe('');
    expect(otherAppsLabel(1)).toBe('(+1 more app)');
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
