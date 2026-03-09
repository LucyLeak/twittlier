import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ACCESS_COOKIE_NAME,
  getAccessSecret,
  getCookieValueFromHeader,
  isAccessCookieValid
} from "@/lib/access-cookie";
import { checkRateLimit, getRequestIdentifier } from "@/lib/rate-limit";

type RegisterBody = {
  email?: string;
  password?: string;
  name?: string;
  handle?: string;
  youtubeAccount?: string;
  profilePhotoUrl?: string;
};

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Variaveis NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configuradas."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

function isValidEmail(value: string) {
  return value.includes("@") && value.includes(".");
}

export async function POST(request: Request) {
  try {
    const accessSecret = getAccessSecret();
    if (!accessSecret) {
      return NextResponse.json(
        { error: "Configuracao de acesso nao encontrada no servidor." },
        { status: 500 }
      );
    }

    const requester = getRequestIdentifier(request);
    const rateLimit = checkRateLimit({
      scope: "auth-register",
      key: requester,
      limit: 5,
      windowMs: 60 * 60 * 1000
    });

    if (rateLimit.limited) {
      return NextResponse.json(
        { error: "Muitas tentativas de cadastro. Aguarde para tentar de novo." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds)
          }
        }
      );
    }

    const accessCookieValue = getCookieValueFromHeader(
      request.headers.get("cookie"),
      ACCESS_COOKIE_NAME
    );
    const hasPrivateAccess = await isAccessCookieValid(accessCookieValue, accessSecret);
    if (!hasPrivateAccess) {
      return NextResponse.json({ error: "Acesso privado invalido." }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as RegisterBody | null;
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password?.trim();

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "Email invalido." }, { status: 400 });
    }

    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: "A senha precisa ter pelo menos 6 caracteres." },
        { status: 400 }
      );
    }

    const adminClient = getAdminClient();
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: body?.name ?? null,
        handle: body?.handle ?? null,
        youtube_account: body?.youtubeAccount ?? null,
        profile_photo_url: body?.profilePhotoUrl ?? null
      }
    });

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("already") || message.includes("registered")) {
        return NextResponse.json(
          { error: "Esse email ja esta cadastrado." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, userId: data.user?.id ?? null });
  } catch (caughtError) {
    const messageText =
      caughtError instanceof Error ? caughtError.message : "Erro interno ao criar conta.";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
