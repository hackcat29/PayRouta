import { ButtonLink, Eyebrow } from "@/components/shared";
export default function NotFound() {
  return (
    <div className="error-page">
      <Eyebrow>404 · Route not found</Eyebrow>
      <h1>This route doesn’t connect.</h1>
      <p>
        The page may have moved, or the address may be incomplete. Find your way
        back to PayRouta.
      </p>
      <ButtonLink href="/">Back to home</ButtonLink>
    </div>
  );
}
