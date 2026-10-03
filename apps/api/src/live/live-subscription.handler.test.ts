import { liveRoom, SOCKET_EVENTS } from '@nexus/shared';
import { describe, expect, it, vi } from 'vitest';

import { FakeAppSlugs, KNOWN_APP_SLUG } from '../../test/fixtures/fake-query-repositories';
import { silentLogger } from '../../test/ingest-fixtures';
import type { Viewer } from '../domain/viewer';
import type { AppSlugResolver } from '../services/app-slug.resolver';
import { LiveSubscriptionHandler, SUBSCRIBE_ERRORS } from './live-subscription.handler';
import type { LiveSocket } from './live-socket';

const ADMIN: Viewer = { email: 'boss@libas.in', isAdmin: true };
const VIEWER: Viewer = { email: 'amit@libas.in', isAdmin: false };

/** A fake socket whose rooms behave like Socket.io's (own id room + joined rooms). */
function fakeSocket(viewer: Viewer) {
  const rooms = new Set<string>(['socket-id']);
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    data: { viewer, expiresAtMs: Date.now() + 60_000 },
    rooms,
    join: vi.fn((room: string) => void rooms.add(room)),
    leave: vi.fn((room: string) => void rooms.delete(room)),
    on: (event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener),
  };
  return { socket: socket as unknown as LiveSocket, rooms, listeners };
}

function handler(resolver: Pick<AppSlugResolver, 'resolve'> = new FakeAppSlugs()) {
  return new LiveSubscriptionHandler(resolver as AppSlugResolver, silentLogger());
}

describe('LiveSubscriptionHandler', () => {
  it('joins the role room of the scope (role from the socket, never from the client)', async () => {
    const { socket, rooms } = fakeSocket(VIEWER);
    const ack = vi.fn();
    const result = await handler().subscribe(socket, { app: KNOWN_APP_SLUG, role: 'admin' }, ack);
    expect(result).toEqual({ ok: true, scope: `app:${KNOWN_APP_SLUG}` });
    expect(ack).toHaveBeenCalledWith(result);
    expect([...rooms]).toEqual(['socket-id', liveRoom({ app: KNOWN_APP_SLUG }, 'viewer')]);
  });

  it('moves the socket when it subscribes to another scope (one scope at a time)', async () => {
    const { socket, rooms } = fakeSocket(ADMIN);
    const live = handler();
    await live.subscribe(socket, { app: KNOWN_APP_SLUG });
    await live.subscribe(socket, {});
    expect([...rooms]).toEqual(['socket-id', liveRoom({}, 'admin')]);
  });

  it('rejects an invalid filter or an unknown app without joining anything', async () => {
    const { socket, rooms } = fakeSocket(ADMIN);
    const live = handler();
    expect(await live.subscribe(socket, { app: '../etc' })).toMatchObject({
      ok: false,
      error: SUBSCRIBE_ERRORS.invalidFilter,
    });
    expect(await live.subscribe(socket, 'not an object')).toMatchObject({ ok: false });
    expect(await live.subscribe(socket, { app: 'no-such-app' })).toEqual({
      ok: false,
      scope: 'app:no-such-app',
      error: SUBSCRIBE_ERRORS.unknownApp,
    });
    expect([...rooms]).toEqual(['socket-id']);
  });

  it('answers "unavailable" when the app lookup fails for another reason', async () => {
    const { socket } = fakeSocket(ADMIN);
    const failing = { resolve: () => Promise.reject(new Error('db down')) };
    expect(await handler(failing).subscribe(socket, { app: KNOWN_APP_SLUG })).toMatchObject({
      ok: false,
      error: SUBSCRIBE_ERRORS.unavailable,
    });
  });

  it('tolerates a missing or non-function ack', async () => {
    const { socket } = fakeSocket(ADMIN);
    await expect(handler().subscribe(socket, {}, 'nope')).resolves.toMatchObject({ ok: true });
    await expect(handler().subscribe(socket, {})).resolves.toMatchObject({ ok: true });
  });

  it('unsubscribe leaves the room; register wires both events', async () => {
    const { socket, rooms, listeners } = fakeSocket(ADMIN);
    const live = handler();
    live.register(socket);
    expect([...listeners.keys()]).toEqual([SOCKET_EVENTS.subscribe, SOCKET_EVENTS.unsubscribe]);
    await live.subscribe(socket, {});
    expect(await live.unsubscribe(socket, {})).toEqual({ ok: true, scope: 'all' });
    expect([...rooms]).toEqual(['socket-id']);
  });
});
