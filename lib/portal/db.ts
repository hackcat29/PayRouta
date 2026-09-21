import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { portalDb?: PrismaClient };
export const db =
  globalDb.portalDb ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString:
        process.env.DATABASE_URL ||
        "postgresql://unconfigured@127.0.0.1:55432/unconfigured",
    }),
  });
if (process.env.NODE_ENV !== "production") globalDb.portalDb = db;
