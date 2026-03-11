import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeHandle } from "@/lib/account-utils";

type LiveMessageRow = {
  id: string;
  room_owner_user_id: string;
  author_user_id: string;
  content: string | null;
  media_url: string | null;
  media_type: "image" | "video" | "gif" | null;
  created_at: string;
};

const LIVE_OVERLAY_RETENTION_HOURS = 6;
const LIVE_OVERLAY_MAX_MESSAGES = 120;

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

function getExpectedOverlayKey() {
  return process.env.OBS_OVERLAY_KEY ?? "";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawStream = url.searchParams.get("stream") || "";
    const stream = normalizeHandle(rawStream);
    const key = url.searchParams.get("key") || "";
    const expectedKey = getExpectedOverlayKey();

    if (!expectedKey) {
      return NextResponse.json(
        { error: "OBS_OVERLAY_KEY nao esta configurada no ambiente." },
        { status: 500 }
      );
    }

    if (!key || key !== expectedKey) {
      return NextResponse.json({ error: "Chave de overlay invalida." }, { status: 401 });
    }

    if (!stream) {
      return NextResponse.json({ error: "Parametro stream invalido." }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: roomOwner, error: roomError } = await admin
      .from("accounts")
      .select("user_id, handle, name")
      .eq("handle", stream)
      .maybeSingle();

    if (roomError) {
      return NextResponse.json({ error: roomError.message }, { status: 400 });
    }

    if (!roomOwner) {
      return NextResponse.json({ error: "Sala de live nao encontrada." }, { status: 404 });
    }

    const cutoffIso = new Date(
      Date.now() - LIVE_OVERLAY_RETENTION_HOURS * 60 * 60 * 1000
    ).toISOString();

    const { data: messagesRaw, error: messagesError } = await admin
      .from("live_messages")
      .select("id, room_owner_user_id, author_user_id, content, media_url, media_type, created_at")
      .eq("room_owner_user_id", roomOwner.user_id)
      .eq("moderation_status", "approved")
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(LIVE_OVERLAY_MAX_MESSAGES);

    if (messagesError) {
      return NextResponse.json({ error: messagesError.message }, { status: 400 });
    }

    const messages = (messagesRaw as LiveMessageRow[]) ?? [];
    const authorIds = Array.from(new Set(messages.map((message) => message.author_user_id)));

    const authorHandleMap = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: authorsRaw, error: authorsError } = await admin
        .from("accounts")
        .select("user_id, handle")
        .in("user_id", authorIds);

      if (authorsError) {
        return NextResponse.json({ error: authorsError.message }, { status: 400 });
      }

      for (const author of authorsRaw ?? []) {
        authorHandleMap.set(author.user_id as string, String(author.handle || "anon"));
      }
    }

    const responsePayload = {
      roomOwner: {
        user_id: String(roomOwner.user_id),
        handle: String(roomOwner.handle),
        name: roomOwner.name ? String(roomOwner.name) : null
      },
      messages: messages.map((message) => ({
        id: message.id,
        author_user_id: message.author_user_id,
        author_handle: authorHandleMap.get(message.author_user_id) || "anon",
        content: message.content,
        media_url: message.media_url,
        media_type: message.media_type,
        created_at: message.created_at
      }))
    };

    return NextResponse.json(responsePayload, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (caughtError) {
    const messageText =
      caughtError instanceof Error ? caughtError.message : "Falha ao carregar overlay da live.";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
