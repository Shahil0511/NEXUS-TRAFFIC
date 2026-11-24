# ADR 0016 — English-only screen copy, page icons and illustrations, display-time macOS label

- **Status:** accepted (2026-11-24). Supersedes in part [ADR 0014](0014-object-first-navigation-and-person-page.md)
  (decision 2: the hero no longer prints a second, Hinglish sentence; `NavItem.questionHi` is gone).
  The rest of ADR 0014 is unchanged.
- **Context:** ADR 0014 gave every nav item an English `question` and a Hinglish `questionHi`, and the
  hero printed both. Two sentences that say the same thing made every page longer, read unevenly next
  to English labels, and had to be kept in step by hand. Pages also opened with text only, and the
  empty, error and "not for you" states looked alike whatever had happened. Device facts printed what
  the User-Agent parser stores, so a Mac showed "Mac OS 10": browsers freeze the macOS version in the
  User-Agent at 10.15.7, so that number is wrong for almost every Mac.
- **Decision:**
  1. **Screen copy is English only.** Professional, short, plain sentences; one name per thing (the
     sidebar label, read with `navLabel(id)` in `apps/web/src/lib/nav.ts`, wherever copy names another
     page). `NavItem` has `question` (one English sentence) and no `questionHi`
     (`apps/web/src/components/MobileNav.test.tsx` checks that no item carries it). Wording stays
     neutral and descriptive, as ADR 0014 decision 6 already says.
  2. **Every page hero shows its section's icon** in a brand-gradient tile (`--brand-from` /
     `--brand-to` tokens, `apps/web/src/components/PageHeader.tsx`). **List pages also show a small
     illustration** on the right from md up, looked up by the active nav item in `NAV_ILLUSTRATIONS`
     (`apps/web/src/components/illustrations/index.ts`, a `Record<NavItemId, …>`, so a new nav item
     without art fails the typecheck). Detail pages keep the icon but get no illustration: their
     title is a long identifier that needs the width.
  3. **Empty, error, admins-only, no-access and not-found states open with state art**
     (`apps/web/src/components/StateArt.tsx`): a small scene from `STATE_ILLUSTRATIONS` plus a badge
     with the state's own icon. The heading and text under it are what explain the state. Major panels
     may show a small icon (`Panel`'s `icon` prop).
  4. **Art is inline SVG, not raster images.** Every drawing goes through `IllustrationFrame`
     (`apps/web/src/components/illustrations/IllustrationFrame.tsx`): `aria-hidden`, not focusable, no
     text, and colours only from token utilities (`fill-primary/…`, `stroke-border`, `fill-chart-…`),
     so one drawing is right in the light and the dark theme. SVG stays sharp at any size, adds a few
     hundred bytes per drawing instead of an image request, and needs no build step. Motion runs only
     under `motion-safe` (the Live pulse), and `globals.css` also stops animations under
     prefers-reduced-motion. `apps/web/src/components/illustrations/illustrations.test.tsx` checks that
     every nav id has art, all art is aria-hidden with no text, and every colour class is a token.
  5. **macOS is one label at display time.** `formatOsName` (`apps/web/src/lib/format.ts`) prints every
     macOS form the parser stores ("Mac OS 10", "Mac OS X", "macOS 14") as "macOS". The stored
     `ua_os` value, the API and any filter built from it are unchanged; other systems print as stored.
- **Consequences:**
  - A new page needs a nav item with an English `question`, an icon and an entry in
    `NAV_ILLUSTRATIONS`; the typecheck fails without the last one.
  - New art is added as a component in `apps/web/src/components/illustrations/`, drawn with token
    utilities only; raw colours or text in an SVG fail the illustrations test.
  - Contrast of the brand tile is checked with the other token pairs in
    `apps/web/src/app/designTokens.test.ts`.
  - The OS column cannot tell macOS versions apart. That matches what the browser reports; a real
    version would need client hints, which the SDK does not send.
  - The public guide (`docs/integration/`) is English already; it is not affected by this ADR.
