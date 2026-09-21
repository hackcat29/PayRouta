import "dotenv/config";
import { createOTP } from "@better-auth/utils/otp";
import { localMode } from "../lib/portal/adapters";
if (!localMode())
  throw new Error("Only available in explicit loopback development mode");
createOTP("payrouta-fictional-totp-secret")
  .totp()
  .then((code) =>
    console.log(`Fictional seed account authenticator code: ${code}`),
  );
