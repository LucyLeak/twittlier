import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  ACCESS_COOKIE_TTL_SECONDS,
  createAccessCookieValue,
  getAccessSecret
} from "@/lib/access-cookie";
import { checkRateLimit, getRequestIdentifier } from "@/lib/rate-limit";

const ACCESS_ATTEMPT_LIMIT = 10;
const ACCESS_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

function buildCookieResponse(accessToken: string, validForSeconds = ACCESS_COOKIE_TTL_SECONDS) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: accessToken,
    maxAge: validForSeconds,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
  return response;
}

export async function POST(request: Request) {
  const accessSecret = getAccessSecret();
  if (!accessSecret) {
    return NextResponse.json(
      { error: "Configuracao de acesso nao encontrada no servidor." },
      { status: 500 }
    );
  }

  const requester = getRequestIdentifier(request);
  const rateLimit = checkRateLimit({
    scope: "access-code",
    key: requester,
    limit: ACCESS_ATTEMPT_LIMIT,
    windowMs: ACCESS_ATTEMPT_WINDOW_MS
  });

  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Muitas tentativas. Aguarde e tente novamente." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds)
        }
      }
    );
  }

  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim();

  const expectedCode = process.env.SITE_ACCESS_CODE;
  if (!expectedCode || !code || code !== expectedCode) {
    return NextResponse.json({ error: "Codigo invalido." }, { status: 401 });
  }

  const accessToken = await createAccessCookieValue(accessSecret);
  return buildCookieResponse(accessToken);
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: "",
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
  return response;
}
