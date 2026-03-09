import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, getAccessSecret, isAccessCookieValid } from "@/lib/access-cookie";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessSecret = getAccessSecret();
  const accessCookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const hasAccess = accessSecret ? await isAccessCookieValid(accessCookie, accessSecret) : false;
  const searchParams = request.nextUrl.searchParams;
  const expectedOverlayKey = process.env.OBS_OVERLAY_KEY;
  const suppliedOverlayKey = searchParams.get("key");
  const hasValidOverlayKey =
    Boolean(expectedOverlayKey) && suppliedOverlayKey === expectedOverlayKey;
  const isOverlayRoute = pathname === "/live" && searchParams.get("overlay") === "1";

  const isAccessRoute =
    pathname === "/acesso" || pathname === "/api/access" || pathname === "/api/live-overlay";

  if (!hasAccess && !isAccessRoute && !(isOverlayRoute && hasValidOverlayKey)) {
    return NextResponse.redirect(new URL("/acesso", request.url));
  }

  if (hasAccess && pathname === "/acesso") {
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
