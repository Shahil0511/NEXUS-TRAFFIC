-- intent: widen the person access log to three more parts of a person's data (ADR 0017):
--         'person_day' (one IST day of the Daily activity tab), 'person_pattern' (usual activity
--         hours) and 'person_visit_steps' (the steps of one visit of a verified person, now
--         admin-only). Widening only: every value 0013 allowed is still allowed, so the running
--         API keeps working before and after. 0013 is applied (its sha256 is in the ledger) and is
--         not edited. The append-only triggers fire on UPDATE, DELETE and TRUNCATE, not on ALTER.

ALTER TABLE traffic.person_access_log DROP CONSTRAINT person_access_log_surface_check;

-- Mirrors PERSON_ACCESS_SURFACE_VALUES (packages/shared/src/constants/traffic.ts).
-- Added NOT VALID, then validated in the next statement: the existing rows are checked once, and
-- the constraint ends validated (pg_constraint.convalidated), like the one it replaces. The runner
-- wraps this file in one transaction, so no row can be written between the DROP and the ADD.
ALTER TABLE traffic.person_access_log ADD CONSTRAINT person_access_log_surface_check CHECK (
  surface IN (
    'person_profile', 'person_timeline', 'person_devices', 'person_daily',
    'person_visits', 'person_failures',
    'person_day', 'person_pattern', 'person_visit_steps'
  )
) NOT VALID;

ALTER TABLE traffic.person_access_log VALIDATE CONSTRAINT person_access_log_surface_check;
