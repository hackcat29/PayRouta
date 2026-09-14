export type AnalyticsEvent = "cta" | "docs" | "demo" | "enquiry";
export type AnalyticsData = {
  action?: string;
  intent?: string;
  outcome?: string;
};
let adapter: ((event: AnalyticsEvent, data: AnalyticsData) => void) | undefined;
export function configureAnalytics(next: typeof adapter) {
  adapter = next;
}
export function track(event: AnalyticsEvent, data: AnalyticsData = {}) {
  adapter?.(event, data);
}
