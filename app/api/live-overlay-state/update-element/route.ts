import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionUserWithRetry } from "@/lib/session-utils";

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

export async function PATCH(request: Request) {
  try {
    const sessionUser = await getSessionUserWithRetry();
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Nao autenticado." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      elementId,
      roomOwnerId,
      displayXPercent,
      displayYPercent,
      displaySizePercent,
      zIndex,
      audioVolumePercent
    } = body;

    if (!elementId || !roomOwnerId) {
      return NextResponse.json(
        { error: "elementId e roomOwnerId sao obrigatorios." },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (Number.isFinite(displayXPercent)) updateData.display_x_percent = displayXPercent;
    if (Number.isFinite(displayYPercent)) updateData.display_y_percent = displayYPercent;
    if (Number.isFinite(displaySizePercent)) updateData.display_size_percent = displaySizePercent;
    if (Number.isFinite(zIndex)) updateData.z_index = zIndex;
    if (Number.isFinite(audioVolumePercent)) updateData.audio_volume_percent = audioVolumePercent;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "Nenhum campo para atualizar." },
        { status: 400 }
      );
    }

    // Update element
    const { data: updatedElement, error: updateError } = await admin
      .from("live_overlay_active_elements")
      .update(updateData)
      .eq("id", elementId)
      .eq("room_owner_user_id", roomOwnerId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 400 }
      );
    }

    if (!updatedElement) {
      return NextResponse.json(
        { error: "Elemento nao encontrado." },
        { status: 404 }
      );
    }

    // Increment version
    await admin
      .from("live_overlay_state_version")
      .upsert({
        room_owner_user_id: roomOwnerId,
        version: (await admin
          .from("live_overlay_state_version")
          .select("version")
          .eq("room_owner_user_id", roomOwnerId)
          .maybeSingle()
          .then((r) => r.data?.version ?? 0)) + 1,
        last_updated_at: new Date().toISOString()
      });

    return NextResponse.json(
      {
        success: true,
        element: updatedElement
      },
      { status: 200 }
    );
  } catch (caughtError) {
    const messageText =
      caughtError instanceof Error
        ? caughtError.message
        : "Falha ao atualizar elemento.";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
