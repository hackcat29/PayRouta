import { NextResponse, type NextRequest } from "next/server";
import { PortalError } from "@/lib/portal/domain";
import {
  createCreditIntent,
  resolveContinentalCreditRoute,
} from "@/lib/payments/credit-intents";

export async function GET(request: NextRequest) {
  try {
    const country = request.nextUrl.searchParams.get("country") ?? "NG";
    const route = resolveContinentalCreditRoute(country);
    return NextResponse.json({ route });
  } catch (err) {
    if (err instanceof PortalError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const intent = createCreditIntent(body);
    return NextResponse.json(intent, { status: 201 });
  } catch (err) {
    if (err instanceof PortalError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "INVALID_CREDIT_INTENT_PAYLOAD" }, { status: 400 });
  }
}
