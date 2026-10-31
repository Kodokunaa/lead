-- Runtime role for the API. Migrations run as the owner; the API connects as lead_app, which owns
-- nothing, so it cannot alter tables or disable triggers. The migrate script sets its password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lead_app') THEN
    CREATE ROLE lead_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- PostgreSQL 14 and older let every role create objects in public; nobody but the owner should.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO lead_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lead_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lead_app;
--> statement-breakpoint
-- Tables created by later migrations get the same rights automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lead_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO lead_app;
--> statement-breakpoint
-- The audit trail is append-only for the app as well as by trigger.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM lead_app;
