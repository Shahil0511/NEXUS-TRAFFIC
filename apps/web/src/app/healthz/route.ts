/**
 * GET /traffic/healthz — the container healthcheck (docker-compose.yml `web.healthcheck`,
 * scripts/deploy.sh). No auth: src/proxy.ts excludes it from its matcher. It proves only that the
 * Next server answers; the api has its own /api/health/ready.
 */
export const dynamic = 'force-dynamic';

const HEALTHY_BODY = 'ok';

export function GET(): Response {
  return new Response(HEALTHY_BODY, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
