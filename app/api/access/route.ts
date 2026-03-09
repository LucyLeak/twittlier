import { NextResponse } from "next/server";

const ACCESS_COOKIE = "tw_private_access";

function buildCookieResponse(validForDays = 30) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: "ok",
    maxAge: 60 * 60 * 24 * validForDays,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
  return response;
}

export async function POST(request: Request) {
  const expectedCode = process.env.SITE_ACCESS_CODE;
  if (!expectedCode) {
    return NextResponse.json(
      { error: "SITE_ACCESS_CODE nao esta configurado." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim();

  if (!code || code !== expectedCode) {
    return NextResponse.json({ error: "Codigo invalido." }, { status: 401 });
  }

  return buildCookieResponse();
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ACCESS_COOKIE,
    value: "",
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
  return response;
}
