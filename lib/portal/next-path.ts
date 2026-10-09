// Only internal workspace paths may be used as a post-sign-in destination,
// so a crafted link can never send a user to another site after sign-in.
export function safeNext(value: unknown) {
  return typeof value === "string" &&
    /^\/(merchant|provider)(\/[\w/-]*)?(\?[\w=&%.-]*)?$/.test(value)
    ? value
    : undefined;
}
