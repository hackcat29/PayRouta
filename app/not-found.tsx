import Link from "next/link";
import { docsUrl } from "@/lib/site-config";

export default function NotFound() {
  return (
    <div className="mk">
      <div className="mk-article">
        <header className="mk-article-head">
          <h1 className="mk-h1">Page not found</h1>
          <p className="mk-lead">It may have moved, or the address may be mistyped.</p>
          <p className="mk-cta">
            <Link href="/">Front page</Link>
            <span aria-hidden="true"> · </span>
            <a href={docsUrl("overview")}>Documentation</a>
          </p>
        </header>
      </div>
    </div>
  );
}
