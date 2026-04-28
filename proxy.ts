import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, getAccessSecret, isAccessCookieValid } from "@/lib/access-cookie";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessSecret = getAccessSecret();
  const accessCookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const hasAccess = accessSecret ? await isAccessCookieValid(accessCookie, accessSecret) : false;
  const searchParams = request.nextUrl.searchParams;
  const isLegacyOverlayRoute = pathname === "/live" && searchParams.get("overlay") === "1";
  const isStageOverlayRoute = pathname === "/live/painel/overlay";

  const isAccessRoute =
    pathname === "/acesso" ||
    pathname === "/api/access" ||
    pathname === "/api/live-overlay" ||
    pathname === "/api/live-overlay-state" ||
    pathname === "/api/live-cleanup" ||
    pathname === "/api/live-stage-feed";

  if (!hasAccess && !isAccessRoute && !isStageOverlayRoute && !isLegacyOverlayRoute) {
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
