// Better Stack operational logging, tracing and heartbeat observability.
// Preserves PayRouta-owned domain metrics and alert definitions. Never sends secrets.

export interface LogEntry {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  context?: Record<string, unknown>;
  timestamp?: string;
}

export interface BetterStackConfig {
  sourceToken?: string;
  heartbeatUrl?: string;
  http?: (url: string, options: { method: "POST" | "GET"; headers?: Record<string, string>; body?: string }) => Promise<unknown>;
}

export class BetterStackLogger {
  private sourceToken?: string;
  private heartbeatUrl?: string;
  private http?: BetterStackConfig["http"];

  constructor(config: BetterStackConfig = {}) {
    this.sourceToken = config.sourceToken || process.env.BETTERSTACK_SOURCE_TOKEN;
    this.heartbeatUrl = config.heartbeatUrl || process.env.BETTERSTACK_HEARTBEAT_URL;
    this.http = config.http;
  }

  async log(entry: LogEntry): Promise<boolean> {
    if (!this.sourceToken) {
      // Local fallback / console output
      return false;
    }

    const payload = JSON.stringify({
      dt: entry.timestamp || new Date().toISOString(),
      level: entry.level,
      message: entry.message,
      ...(entry.context ? { context: entry.context } : {}),
    });

    try {
      const url = "https://in.logs.betterstack.com";
      if (this.http) {
        await this.http(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.sourceToken}`,
            "Content-Type": "application/json",
          },
          body: payload,
        });
      } else if (typeof fetch !== "undefined") {
        await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.sourceToken}`,
            "Content-Type": "application/json",
          },
          body: payload,
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  async heartbeat(): Promise<boolean> {
    if (!this.heartbeatUrl) return false;
    try {
      if (this.http) {
        await this.http(this.heartbeatUrl, { method: "GET" });
      } else if (typeof fetch !== "undefined") {
        await fetch(this.heartbeatUrl, { method: "GET" });
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const betterstack = new BetterStackLogger();
