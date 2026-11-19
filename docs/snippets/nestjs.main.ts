/**
 * Data Nexus Traffic — NestJS wiring (Nest 10/11 on platform-express).
 *
 * WHY `app.use` in main.ts (and not an interceptor): an Express-level middleware sees EVERY request,
 * including unmatched-route 404s, guards that reject, and errors thrown before interceptors run.
 *
 * Steps:
 *   1. Save express-esm.ts from the guide as `src/nexus.ts` (tsc compiles it to CommonJS for Nest).
 *   2. Add NEXUS_URL and NEXUS_SECRET_KEY to the backend environment (server ONLY). Optional:
 *      NEXUS_ENVIRONMENT = prod | staging | dev (unset → prod; set it on staging/dev so their traffic
 *      stays off prod dashboards) and NEXUS_RELEASE = your build label (e.g. a git sha).
 *   3. Merge the lines marked `// Nexus` into your existing src/main.ts.
 *
 * !!! getUser DEFAULTS TO ANONYMOUS. Without it EVERY event is stored with no user. Return your
 * !!! VERIFIED user's email from whatever your guard/interceptor attaches to the request (below). It
 * !!! is read when the response ends, so values set later by guards are visible.
 *
 * Contract: https://nexus.libas.in/traffic/api/docs/
 */
import { NestFactory } from '@nestjs/core';
import type { Request } from 'express';

import { AppModule } from './app.module';
import { createNexusClient, nexusMiddleware } from './nexus'; // Nexus

/** Shape your interceptor/guard attaches to the request (adapt to your app). */
interface WithUser {
  storeScope?: { email?: string };
  user?: { email?: string };
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Nexus — BEFORE setGlobalPrefix/useGlobal* so it wraps every request.
  const nexus = createNexusClient({
    url: process.env.NEXUS_URL,
    key: process.env.NEXUS_SECRET_KEY,
    environment: process.env.NEXUS_ENVIRONMENT, // prod | staging | dev — sent ONLY when valid
  });
  app.use(
    nexusMiddleware({
      client: nexus,
      basePath: '', // the public prefix your gateway strips before Nest sees the path ('' if none)
      trustProxyHops: 2, // gateway → Next.js rewrite → Nest. Use 1 if the gateway calls Nest directly.
      // Read at response end, so values set later by guards/interceptors are visible here.
      getUser: (req: Request) =>
        (req as Request & WithUser).storeScope?.email ?? (req as Request & WithUser).user?.email,
    }),
  );

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // Nexus — flush queued events when Nest closes the HTTP server (SIGTERM via enableShutdownHooks).
  app.getHttpServer().on('close', () => void nexus.shutdown());

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
