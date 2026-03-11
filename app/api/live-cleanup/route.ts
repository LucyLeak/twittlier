import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ACCESS_COOKIE_NAME,
  getAccessSecret,
  getCookieValueFromHeader,
  isAccessCookieValid
} from "@/lib/access-cookie";
import { checkRateLimit, getRequestIdentifier } from "@/lib/rate-limit";

const CLEANUP_ATTEMPT_LIMIT = 12;
const CLEANUP_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MIN_RETENTION_HOURS = 1;
const MAX_RETENTION_HOURS = 48;
const DEFAULT_RETENTION_HOURS = 6;

function clampRetentionHours(input: number) {
  if (!Number.isFinite(input)) return DEFAULT_RETENTION_HOURS;
  return Math.min(MAX_RETENTION_HOURS, Math.max(MIN_RETENTION_HOURS, input));
}

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

async function validateAccessCookie(request: Request) {
  const accessSecret = getAccessSecret();
  if (!accessSecret) return false;
  const cookieHeader = request.headers.get("cookie");
  const accessCookie = getCookieValueFromHeader(cookieHeader, ACCESS_COOKIE_NAME);
  return isAccessCookieValid(accessCookie, accessSecret);
}

export async function POST(request: Request) {
  try {
    const hasAccess = await validateAccessCookie(request);
    if (!hasAccess) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 401 });
    }

    const requester = getRequestIdentifier(request);
    const rateLimit = checkRateLimit({
      scope: "live-cleanup",
      key: requester,
      limit: CLEANUP_ATTEMPT_LIMIT,
      windowMs: CLEANUP_ATTEMPT_WINDOW_MS
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

    const payload = (await request.json().catch(() => null)) as
      | { roomOwnerUserId?: string; retentionHours?: number }
      | null;
    const roomOwnerUserId =
      typeof payload?.roomOwnerUserId === "string" ? payload.roomOwnerUserId.trim() : "";
    if (!roomOwnerUserId) {
      return NextResponse.json(
        { error: "roomOwnerUserId ausente." },
        { status: 400 }
      );
    }

    const retentionHours = clampRetentionHours(payload?.retentionHours ?? DEFAULT_RETENTION_HOURS);
    const cutoffIso = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();

    const admin = getAdminClient();
    const { error } = await admin
      .from("live_messages")
      .delete()
      .eq("room_owner_user_id", roomOwnerUserId)
      .lt("created_at", cutoffIso);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (caughtError) {
    const messageText =
      caughtError instanceof Error ? caughtError.message : "Falha ao limpar mensagens.";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
