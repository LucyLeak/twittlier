import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "tw_private_access";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAccess = request.cookies.get(ACCESS_COOKIE)?.value === "ok";

  const isAccessRoute = pathname === "/acesso" || pathname === "/api/access";

  if (!hasAccess && !isAccessRoute) {
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
