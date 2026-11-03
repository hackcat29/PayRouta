-- Documents merchants upload as their volume and business type need them
-- (lib/merchant/requirements.ts). Their own audience keeps them out of the
-- provider requirements and the merchant application's requirement list.
INSERT INTO "Requirement" ("id", "templateId", "version", "name", "scope", "illustrative", "active")
VALUES
  ('req_onboarding_government_id', 'onboarding:government-id', 1, 'Government ID', '{"audience": "merchant-onboarding", "document": "government-id"}', false, true),
  ('req_onboarding_registration_certificate', 'onboarding:registration-certificate', 1, 'Business registration certificate', '{"audience": "merchant-onboarding", "document": "registration-certificate"}', false, true),
  ('req_onboarding_proof_of_address', 'onboarding:proof-of-address', 1, 'Proof of address', '{"audience": "merchant-onboarding", "document": "proof-of-address"}', false, true)
ON CONFLICT DO NOTHING;
