/**
 * Switches for finished screens that wait on a check outside the code before they show.
 *
 * WHY A FILE OF ITS OWN: a screen can be built, tested and merged while one fact about production
 * is still missing. The switch keeps it hidden — and sends none of its reads — until that fact is
 * noted in ai-context/PROGRESS.md; the commit that notes it flips the switch. Tests cover both
 * states by mocking this module.
 */

/**
 * The "Usual activity hours" panel of the person page's Daily activity tab (ROUTES.users.pattern,
 * UsualActivityHoursPanel). WHY false: the grid's read scans up to 31 days of one person in both
 * tables; it waits for the owner's EXPLAIN ANALYZE of that read on production (one person with a
 * lot of activity, 30 days), to be noted in ai-context/PROGRESS.md. While false the panel is not
 * rendered and no pattern request is sent. The API leaf is registered and tested either way.
 * @see ../../../../ai-context/decisions/0017-person-daily-depth.md
 */
export const USUAL_ACTIVITY_HOURS_ENABLED: boolean = false;
