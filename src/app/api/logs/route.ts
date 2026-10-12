import { NextResponse } from "next/server";
import { db } from "@/db";
import { actuationLogs, calibrationEvents } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = parseInt(searchParams.get("limit") || "40", 10);

    const logs = await db
      .select()
      .from(actuationLogs)
      .orderBy(desc(actuationLogs.createdAt))
      .limit(limitParam);

    const calibs = await db
      .select()
      .from(calibrationEvents)
      .orderBy(desc(calibrationEvents.createdAt))
      .limit(20);

    return NextResponse.json({
      success: true,
      logs,
      calibrationEvents: calibs,
    });
  } catch (error) {
    console.error("GET /api/logs error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch logs" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await db.delete(actuationLogs);
    return NextResponse.json({ success: true, message: "Actuation logs reset" });
  } catch (error) {
    console.error("DELETE /api/logs error:", error);
    return NextResponse.json({ success: false, error: "Failed to reset logs" }, { status: 500 });
  }
}
