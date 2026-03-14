import { getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error" }, { status: 503 });
  }
}
