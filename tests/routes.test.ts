import { test } from "node:test";
import assert from "node:assert/strict";
import {
  marketingPaths,
  legacyRedirects,
  primaryRoutes,
} from "../lib/site-config";
import sitemap from "../app/sitemap";
import { generateStaticParams, generateMetadata } from "../app/[...path]/page";
test("canonical routes, metadata and sitemap exclude legacy and empty parent paths", async () => {
  const previous = process.env.SITE_URL;
  process.env.SITE_URL = "https://payrouta.example";
  try {
    const urls = sitemap().map((entry) => new URL(entry.url).pathname);
    for (const [slug, path] of Object.entries(marketingPaths)) {
      assert.ok(urls.includes(path), slug);
      const metadata = await generateMetadata({
        params: Promise.resolve({ path: path.slice(1).split("/") }),
      });
      assert.equal(metadata.alternates?.canonical, path);
    }
    const generated = generateStaticParams().map((p) => "/" + p.path.join("/"));
    assert.deepEqual(
      new Set(generated),
      new Set(Object.values(marketingPaths)),
    );
    for (const { source, destination } of legacyRedirects) {
      assert.ok(!urls.includes(source));
      assert.ok(!generated.includes(source));
      assert.ok(primaryRoutes.some(([path]) => path === destination));
    }
    assert.ok(!urls.includes("/platform") && !urls.includes("/solutions"));
  } finally {
    if (previous === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous;
  }
});
