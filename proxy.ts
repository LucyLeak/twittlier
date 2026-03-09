import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "tw_private_access";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAccess = request.cookies.get(ACCESS_COOKIE)?.value === "ok";
  const searchParams = request.nextUrl.searchParams;
  const expectedOverlayKey =
    process.env.OBS_OVERLAY_KEY ?? process.env.NEXT_PUBLIC_OBS_OVERLAY_KEY;
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
