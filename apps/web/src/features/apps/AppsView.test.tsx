import { INGEST_HEADERS, ROUTES, type MeDto } from '@nexus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_APPS, KEY_CREATED, NEW_SECRET, PUBLISHABLE_KEY } from '@/test/adminFixtures';
import { routeUrl, server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

import { AppsView } from './AppsView';

const ADMIN: MeDto = { email: 'boss@libas.in', isAdmin: true };
const VIEWER: MeDto = { email: 'viewer@libas.in', isAdmin: false };
const NEXUS_URL = 'https://nexus.libas.in/traffic';

/** Serves me + apps.list and counts list calls (refetch after a mutation). */
function serve(me: MeDto) {
  const calls = { list: 0 };
  server.use(
    http.get(routeUrl(ROUTES.me.get), () => HttpResponse.json(me)),
    http.get(routeUrl(ROUTES.apps.list), () => {
      calls.list += 1;
      return HttpResponse.json(ADMIN_APPS);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppsView — access', () => {
  it('shows the admins-only state to a non-admin and never loads the admin list', async () => {
    const calls = serve(VIEWER);
    renderWithProviders(<AppsView nexusUrl={NEXUS_URL} />);
    expect(await screen.findByText('Admins only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Register app/ })).not.toBeInTheDocument();
    expect(calls.list).toBe(0);
  });
});

describe('AppsView — admin', () => {
  it('lists apps with settings, integration values and keys (prefixes only)', async () => {
    serve(ADMIN);
    renderWithProviders(<AppsView nexusUrl={NEXUS_URL} />);

    const card = await screen.findByRole('region', { name: 'EBO Sales' });
    expect(within(card).getByText('/ebo-sales')).toBeInTheDocument();
    expect(within(card).getByText('https://nexus.libas.in')).toBeInTheDocument();

    const values = within(card).getByRole('region', { name: 'Integration values for EBO Sales' });
    expect(values).toHaveTextContent(`NEXUS_URL=${NEXUS_URL}`);
    expect(values).toHaveTextContent(`NEXT_PUBLIC_NEXUS_KEY=${PUBLISHABLE_KEY}`);
    expect(values).toHaveTextContent('nx_sk_… (shown once, at creation)');

    const keys = within(card).getByRole('table', { name: 'Keys of EBO Sales' });
    expect(within(keys).getByText('nx_sk_AbCd1234…')).toBeInTheDocument();
    expect(within(keys).getAllByText('active')).toHaveLength(2);
  });

  it('creates a key and reveals the plaintext ONCE, with copy, then forgets it', async () => {
    const user = userEvent.setup();
    const calls = serve(ADMIN);
    let seen: { body: unknown; csrf: string | null } | undefined;
    server.use(
      http.post(routeUrl(ROUTES.apps.createKey), async ({ request, params }) => {
        seen = { body: await request.json(), csrf: request.headers.get(INGEST_HEADERS.dashboard) };
        expect(params.slug).toBe('ebo-sales');
        return HttpResponse.json(KEY_CREATED, { status: 201 });
      }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const log = vi.spyOn(console, 'log');

    renderWithProviders(<AppsView nexusUrl={NEXUS_URL} />);
    await user.click(await screen.findByRole('button', { name: 'New key for EBO Sales' }));

    const dialog = await screen.findByRole('dialog', { name: 'New key for EBO Sales' });
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(await within(dialog).findByText(/Too small|at least|>=1/i)).toBeInTheDocument();
    expect(seen).toBeUndefined();

    await user.type(within(dialog).getByLabelText('Label'), 'rotation 2026-10');
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));

    const reveal = await screen.findByRole('dialog', { name: 'Your new key' });
    expect(seen).toEqual({ body: { kind: 'secret', label: 'rotation 2026-10' }, csrf: '1' });
    expect(within(reveal).getByDisplayValue(NEW_SECRET)).toBeInTheDocument();
    expect(within(reveal).getByText(/will not be shown again/)).toBeInTheDocument();
    // No ✕: the reveal closes only through the explicit acknowledgement.
    expect(within(reveal).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    await user.click(within(reveal).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(NEW_SECRET);
    expect(await within(reveal).findByRole('button', { name: 'Copied' })).toBeInTheDocument();

    await user.click(within(reveal).getByRole('button', { name: 'I have stored the key' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(NEW_SECRET)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(NEW_SECRET);
    await waitFor(() => expect(calls.list).toBeGreaterThanOrEqual(2)); // list invalidated
    for (const call of log.mock.calls) expect(JSON.stringify(call)).not.toContain(NEW_SECRET);
  });

  it('revokes a key through the in-page confirmation (never window.confirm)', async () => {
    const user = userEvent.setup();
    const calls = serve(ADMIN);
    const revoked: string[] = [];
    server.use(
      http.delete(routeUrl(ROUTES.apps.revokeKey), ({ params, request }) => {
        expect(request.headers.get(INGEST_HEADERS.dashboard)).toBe('1');
        revoked.push(String(params.keyId));
        return HttpResponse.json({ ...ADMIN_APPS[0]!.keys[0], revokedAt: '2026-10-01T10:00:00.000Z' });
      }),
    );
    const confirmSpy = vi.spyOn(window, 'confirm');

    renderWithProviders(<AppsView nexusUrl={NEXUS_URL} />);
    await user.click(await screen.findByRole('button', { name: 'Revoke nx_sk_AbCd1234' }));

    const dialog = await screen.findByRole('dialog', { name: /Revoke key/ });
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }));

    await waitFor(() => expect(revoked).toEqual([ADMIN_APPS[0]!.keys[0]!.id]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(calls.list).toBeGreaterThanOrEqual(2));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('expires a key with a grace period (rotation)', async () => {
    const user = userEvent.setup();
    serve(ADMIN);
    let body: { expiresAt?: string } | undefined;
    server.use(
      http.patch(routeUrl(ROUTES.apps.expireKey), async ({ request }) => {
        body = (await request.json()) as { expiresAt: string };
        return HttpResponse.json({ ...ADMIN_APPS[0]!.keys[0], expiresAt: body.expiresAt });
      }),
    );

    renderWithProviders(<AppsView nexusUrl={NEXUS_URL} />);
    await user.click(await screen.findByRole('button', { name: 'Expire nx_sk_AbCd1234' }));
    const dialog = await screen.findByRole('dialog', { name: /Expire key/ });
    await user.click(within(dialog).getByRole('radio', { name: 'Expire in 7 days' }));
    const before = Date.now();
    await user.click(within(dialog).getByRole('button', { name: 'Expire key' }));

    await waitFor(() => expect(body?.expiresAt).toBeDefined());
    const grace = Date.parse(body!.expiresAt!) - before;
    expect(grace).toBeGreaterThan(6.9 * 86_400_000);
    expect(grace).toBeLessThanOrEqual(7 * 86_400_000 + 5_000);
  });

  it('registers an app, validating with the shared schema first', async () => {
    const user = userEvent.setup();
    serve(ADMIN);
    let created: unknown;
    server.use(
      http.post(routeUrl(ROUTES.apps.create), async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ ...ADMIN_APPS[0], slug: 'hr-portal', displayName: 'HR', keys: [] }, { status: 201 });
      }),
    );

    renderWithProviders(<AppsView nexusUrl={NEXUS_URL} />);
    await user.click(await screen.findByRole('button', { name: /Register app/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Register an app' });

    await user.type(within(dialog).getByLabelText('Slug'), '-bad');
    await user.type(within(dialog).getByLabelText('Display name'), 'HR');
    await user.click(within(dialog).getByRole('button', { name: 'Register app' }));
    expect(within(dialog).getByLabelText('Slug')).toHaveAttribute('aria-invalid', 'true');
    expect(created).toBeUndefined();

    await user.clear(within(dialog).getByLabelText('Slug'));
    await user.type(within(dialog).getByLabelText('Slug'), 'hr-portal');
    await user.type(within(dialog).getByLabelText('Base path'), '/hr');
    await user.type(
      within(dialog).getByLabelText('Allowed origins'),
      'https://nexus.libas.in{enter}http://localhost:5173/',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Register app' }));

    await waitFor(() =>
      expect(created).toEqual({
        slug: 'hr-portal',
        displayName: 'HR',
        basePath: '/hr',
        allowedOrigins: ['https://nexus.libas.in', 'http://localhost:5173'],
        browserIngestEnabled: true,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
