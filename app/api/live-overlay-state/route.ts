import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionUserWithRetry } from "@/lib/session-utils";
import { normalizeHandle } from "@/lib/account-utils";

export type OverlayActiveElement = {
  id: string;
  asset_id: string;
  asset_name: string;
  asset_command: string;
  media_url: string;
  media_type: "sound" | "image" | "video";
  image_duration_seconds: number | null;
  display_size_percent: number;
  display_x_percent: number;
  display_y_percent: number;
  display_fit: "contain" | "cover";
  entry_animation: "none" | "fade" | "pop" | "slide-up" | "slide-left";
  audio_volume_percent: number;
  z_index: number;
  added_by_handle: string;
  created_at: string;
  expires_at: string | null;
};

export type OverlayStateResponse = {
  roomOwner: {
    user_id: string;
    handle: string;
    name: string | null;
  };
  elements: OverlayActiveElement[];
  version: number;
  timestamp: string;
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const stream = normalizeHandle(url.searchParams.get("stream") || "");

    if (!stream) {
      return NextResponse.json(
        { error: "Parametro stream invalido." },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // Get room owner
    const { data: roomOwner, error: roomError } = await admin
      .from("accounts")
      .select("user_id, handle, name")
      .eq("handle", stream)
      .maybeSingle();

    if (roomError) {
      return NextResponse.json({ error: roomError.message }, { status: 400 });
    }

    if (!roomOwner) {
      return NextResponse.json(
        { error: "Sala de overlay nao encontrada." },
        { status: 404 }
      );
    }

    // Get active elements, filtering out expired ones
    const now = new Date().toISOString();
    const { data: elementsRaw, error: elementsError } = await admin
      .from("live_overlay_active_elements")
      .select(
        "id, asset_id, asset_name, asset_command, media_url, media_type, image_duration_seconds, display_size_percent, display_x_percent, display_y_percent, display_fit, entry_animation, audio_volume_percent, z_index, added_by_handle, created_at, expires_at"
      )
      .eq("room_owner_user_id", roomOwner.user_id)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("z_index", { ascending: true })
      .order("created_at", { ascending: true });

    if (elementsError) {
      return NextResponse.json(
        { error: elementsError.message },
        { status: 400 }
      );
    }

    // Get version
    const { data: versionData } = await admin
      .from("live_overlay_state_version")
      .select("version")
      .eq("room_owner_user_id", roomOwner.user_id)
      .maybeSingle();

    const version = versionData?.version ?? 1;

    return NextResponse.json(
      {
        roomOwner: {
          user_id: String(roomOwner.user_id),
          handle: String(roomOwner.handle),
          name: roomOwner.name ? String(roomOwner.name) : null
        },
        elements: (elementsRaw ?? []).map((el) => ({
          id: el.id as string,
          asset_id: el.asset_id as string,
          asset_name: el.asset_name as string,
          asset_command: el.asset_command as string,
          media_url: el.media_url as string,
          media_type: el.media_type as "sound" | "image" | "video",
          image_duration_seconds: el.image_duration_seconds as number | null,
          display_size_percent: el.display_size_percent as number,
          display_x_percent: el.display_x_percent as number,
          display_y_percent: el.display_y_percent as number,
          display_fit: el.display_fit as "contain" | "cover",
          entry_animation: el.entry_animation as
            | "none"
            | "fade"
            | "pop"
            | "slide-up"
            | "slide-left",
          audio_volume_percent: el.audio_volume_percent as number,
          z_index: el.z_index as number,
          added_by_handle: el.added_by_handle as string,
          created_at: el.created_at as string,
          expires_at: el.expires_at as string | null
        })),
        version,
        timestamp: new Date().toISOString()
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (caughtError) {
    const messageText =
      caughtError instanceof Error
        ? caughtError.message
        : "Falha ao carregar estado do overlay.";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = getAdminClient();
    const sessionUser = await getSessionUserWithRetry(admin);
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Nao autenticado." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      roomOwnerId,
      assetId,
      assetName,
      assetCommand,
      mediaUrl,
      mediaType,
      imageDurationSeconds,
      displaySizePercent,
      displayXPercent,
      displayYPercent,
      displayFit,
      entryAnimation,
      audioVolumePercent,
      expiresInSeconds
    } = body;

    if (!roomOwnerId || !assetId) {
      return NextResponse.json(
        { error: "roomOwnerId e assetId sao obrigatorios." },
        { status: 400 }
      );
    }

    // Get room owner info
    const { data: roomOwner, error: roomError } = await admin
      .from("accounts")
      .select("user_id, handle")
      .eq("user_id", roomOwnerId)
      .maybeSingle();

    if (roomError || !roomOwner) {
      return NextResponse.json(
        { error: "Room owner nao encontrado." },
        { status: 404 }
      );
    }

    // Calculate expires_at
    let expiresAt = null;
    if (expiresInSeconds && Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
      expiresAt = new Date(
        Date.now() + expiresInSeconds * 1000
      ).toISOString();
    }

    // Insert element
    const { data: insertedElement, error: insertError } = await admin
      .from("live_overlay_active_elements")
      .insert({
        room_owner_user_id: roomOwnerId,
        asset_id: assetId,
        asset_name: assetName || "Element",
        asset_command: assetCommand || "!element",
        media_url: mediaUrl || "",
        media_type: mediaType || "image",
        image_duration_seconds: imageDurationSeconds || null,
        display_size_percent: displaySizePercent || 60,
        display_x_percent: displayXPercent || 50,
        display_y_percent: displayYPercent || 50,
        display_fit: displayFit || "contain",
        entry_animation: entryAnimation || "fade",
        audio_volume_percent: audioVolumePercent || 100,
        added_by_user_id: sessionUser.user_id,
        added_by_handle: sessionUser.handle || "unknown",
        expires_at: expiresAt
      })
      .select("*")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 400 }
      );
    }

    // Increment version
    await admin.rpc("increment_overlay_version", {
      p_room_owner_id: roomOwnerId
    }).catch(() => {
      // If RPC doesn't exist, update manually
      admin
        .from("live_overlay_state_version")
        .upsert({
          room_owner_user_id: roomOwnerId,
          version: 1,
          last_updated_at: new Date().toISOString()
        });
    });

    return NextResponse.json(
      {
        success: true,
        element: insertedElement
      },
      { status: 201 }
    );
  } catch (caughtError) {
    const messageText =
      caughtError instanceof Error
        ? caughtError.message
        : "Falha ao adicionar elemento ao overlay.";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
