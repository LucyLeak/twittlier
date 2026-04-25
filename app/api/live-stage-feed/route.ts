import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeHandle } from "@/lib/account-utils";
import { STAGE_EVENT_RETENTION_HOURS, type StageEventRow } from "@/lib/live-stage";

const LIVE_STAGE_MAX_EVENTS = 120;

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
    const stream = normalizeHandle(url.searchParams.get("stream") || "");
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
      return NextResponse.json({ error: "Sala de overlay nao encontrada." }, { status: 404 });
    }

    const cutoffIso = new Date(
      Date.now() - STAGE_EVENT_RETENTION_HOURS * 60 * 60 * 1000
    ).toISOString();

    const { data: eventsRaw, error: eventsError } = await admin
      .from("live_overlay_events")
      .select(
        "id, room_owner_user_id, asset_id, asset_name, asset_command, media_url, media_type, image_duration_seconds, triggered_by_user_id, triggered_by_handle, created_at"
      )
      .eq("room_owner_user_id", roomOwner.user_id)
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(LIVE_STAGE_MAX_EVENTS);

    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 400 });
    }

    return NextResponse.json(
      {
        roomOwner: {
          user_id: String(roomOwner.user_id),
          handle: String(roomOwner.handle),
          name: roomOwner.name ? String(roomOwner.name) : null
        },
        events: ((eventsRaw as StageEventRow[] | null) ?? []).map((event) => ({
          id: event.id,
          asset_id: event.asset_id,
          asset_name: event.asset_name,
          asset_command: event.asset_command,
          media_url: event.media_url,
          media_type: event.media_type,
          image_duration_seconds: event.image_duration_seconds,
          triggered_by_handle: event.triggered_by_handle,
          created_at: event.created_at
        }))
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (caughtError) {
    const messageText =
      caughtError instanceof Error ? caughtError.message : "Falha ao carregar overlay do palco.";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
