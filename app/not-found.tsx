import { Btn, Kicker } from "@/components/marketing/ui";
import { LineBundle } from "@/components/marketing/route-map";

export default function NotFound() {
  return (
    <div className="mk">
      <section className="mk-page-hero" style={{ minHeight: "70vh" }}>
        <div className="mk-wrap">
          <div className="mk-page-hero-grid solo">
            <div>
              <Kicker n="!">404 · No route found</Kicker>
              <h1 className="mk-h1">
                This line doesn&apos;t connect.
              </h1>
              <p className="mk-lead">
                The page may have moved, or the address may be incomplete. Unlike
                our payments, this one couldn&apos;t find a backup route.
              </p>
              <div className="mk-actions">
                <Btn href="/" large>
                  Back to home
                </Btn>
                <Btn href="/docs" ghost large>
                  Documentation
                </Btn>
              </div>
            </div>
          </div>
          <LineBundle className="mk-strip" />
        </div>
      </section>
    </div>
  );
}
