CREATE FUNCTION protect_registry_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Registry snapshots are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_registry_snapshot BEFORE UPDATE ON "RegistrySnapshot" FOR EACH ROW EXECUTE FUNCTION protect_registry_snapshot();
CREATE FUNCTION protect_requirement_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active') THEN RAISE EXCEPTION 'Create a new requirement version'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_requirement_content BEFORE UPDATE ON "Requirement" FOR EACH ROW EXECUTE FUNCTION protect_requirement_version();
CREATE FUNCTION protect_capability_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN RAISE EXCEPTION 'Create a new capability version'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_capability_content BEFORE UPDATE ON "Capability" FOR EACH ROW EXECUTE FUNCTION protect_capability_version();
