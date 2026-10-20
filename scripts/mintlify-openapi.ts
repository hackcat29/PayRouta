// Writes the merchant API's OpenAPI document (lib/merchant/contracts.ts) for
// the Mintlify docs site, with an absolute server URL for the API playground.
// Run after changing the merchant API: npm run docs:openapi
import { writeFileSync } from "node:fs";
import { openapi } from "../lib/merchant/contracts";

const doc = {
  ...openapi(),
  servers: [
    {
      url: "https://{host}/api/v1",
      description: "Your PayRouta host",
      variables: { host: { default: "your-payrouta-host", description: "Your PayRouta host, from your dashboard" } },
    },
  ],
};
writeFileSync(new URL("../mintlify/openapi/merchant.json", import.meta.url), JSON.stringify(doc, null, 2) + "\n");
console.log("mintlify/openapi/merchant.json:", Object.keys(doc.paths).length, "paths");
