"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="error-page">
      <h1>We couldn’t load this page.</h1>
      <p>
        Please try again. If you were sending an enquiry, delivery may be
        unconfirmed; check before sending another.
      </p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
