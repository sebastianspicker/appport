import { NextResponse } from "next/server";
import { getRelutionGateway } from "@/server/relution";

export const runtime = "nodejs";

export async function GET() {
  try {
    await getRelutionGateway().readiness();
    return NextResponse.json({ status: "ready", service: "relution-appport" });
  } catch {
    return NextResponse.json(
      { status: "not_ready", service: "relution-appport" },
      { status: 503 },
    );
  }
}
