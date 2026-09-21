-- Rollout is an audited operational restriction on a published capability.
-- It may change without rewriting the approved capability, integration,
-- submission, publication or revision. Those versioned facts remain immutable.
CREATE OR REPLACE FUNCTION protect_profile_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'current' - 'rollout') IS DISTINCT FROM (to_jsonb(OLD) - 'current' - 'rollout') THEN
    RAISE EXCEPTION 'Published profile versions are immutable';
  END IF;
  RETURN NEW;
END $$;
