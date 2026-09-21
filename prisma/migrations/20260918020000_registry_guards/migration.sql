-- Additive guards; nullable legacy observations remain untrusted and require review.
CREATE FUNCTION protect_integration_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Integration versions are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_integration BEFORE UPDATE ON "Integration" FOR EACH ROW EXECUTE FUNCTION protect_integration_version();
CREATE FUNCTION protect_profile_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (to_jsonb(NEW) - 'current') IS DISTINCT FROM (to_jsonb(OLD) - 'current') THEN RAISE EXCEPTION 'Published profile versions are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_profile BEFORE UPDATE ON "PublishedProfile" FOR EACH ROW EXECUTE FUNCTION protect_profile_version();
ALTER TABLE "PublishedProfile" ADD CONSTRAINT profile_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE "RegistryHead" ADD CONSTRAINT head_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE "AvailabilityContext" ADD CONSTRAINT context_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE "AvailabilityEvaluation" ADD CONSTRAINT evaluation_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE "AvailabilityContext" ADD CONSTRAINT context_org FOREIGN KEY ("orgId") REFERENCES "Organization"(id);
ALTER TABLE "PublishedProfile" ADD CONSTRAINT profile_submission FOREIGN KEY ("submissionId") REFERENCES "Submission"(id);
ALTER TABLE "PublishedProfile" ADD CONSTRAINT profile_publication FOREIGN KEY ("publicationKey") REFERENCES "RegistrySnapshot"(key);
ALTER TABLE "Availability" ADD CONSTRAINT observation_scope CHECK ("observationType" IS NULL OR ("integrationId" IS NOT NULL AND "capabilityVersion" IS NOT NULL AND trust IN ('operator','adapter','authenticated-provider','simulated') AND "observedAt" IS NOT NULL AND sequence >= 0 AND "expiresAt" > "observedAt" AND NOT (trust = 'simulated' AND environment = 'production')));
CREATE INDEX observation_latest_scope ON "Availability" (environment, "integrationId", "capabilityId", "capabilityVersion", "observationType", trust, sequence DESC, "observedAt" DESC) WHERE "observationType" IS NOT NULL;
