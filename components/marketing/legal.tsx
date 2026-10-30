import { paths } from "@/lib/site-config";

export const legal = {
  entity: "Routa Solutions",
  updated: "9 October 2026",
  email: "support@payrouta.com",
} as const;

// Shared layout for the terms and privacy pages: a contents list beside
// numbered sections.
export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: React.ReactNode;
  sections: [id: string, heading: string, body: React.ReactNode][];
}) {
  return (
    <div className="mk">
      <div className="mk-article">
        <header className="mk-article-head">
          <h1 className="mk-h1">{title}</h1>
          <p className="mk-dateline">Last updated {legal.updated}</p>
          <p>{intro}</p>
        </header>
        <nav className="mk-contents" aria-label="Contents">
          <ol>
            {sections.map(([id, heading]) => (
              <li key={id}>
                <a href={`#${id}`}>{heading}</a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mk-prose mk-legal">
          {sections.map(([id, heading, body], i) => (
            <section id={id} key={id}>
              <h2 className="mk-h3">
                {i + 1}. {heading}
              </h2>
              {body}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export const contactLine = (
  <>
    Email <a href={`mailto:${legal.email}`}>{legal.email}</a> or use our{" "}
    <a href={paths.contact}>contact form</a>.
  </>
);
