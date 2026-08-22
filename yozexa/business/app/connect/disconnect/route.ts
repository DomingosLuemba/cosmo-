import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COOKIE_NAME } from "@/lib/pay";

export async function POST(request: Request): Promise<NextResponse> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  return NextResponse.redirect(new URL("/connect", request.url), 303);
}
