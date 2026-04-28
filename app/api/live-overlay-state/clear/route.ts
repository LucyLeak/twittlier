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

export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUserWithRetry();
    if (!sessionUser) {
      return NextResponse.json(
        { error: "Nao autenticado." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { roomOwnerId } = body;

    if (!roomOwnerId) {
      return NextResponse.json(
        { error: "roomOwnerId eh obrigatorio." },
        { status: 400 }
      );
    }

    const admin = getAdminClient();

    // Delete all elements for this room
    const { error: deleteError } = await admin
      .from("live_overlay_active_elements")
      .delete()
      .eq("room_owner_user_id", roomOwnerId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 400 }
      );
    }

    // Increment version
    const { data: currentVersion } = await admin
      .from("live_overlay_state_version")
      .select("version")
      .eq("room_owner_user_id", roomOwnerId)
      .maybeSingle();

    await admin
      .from("live_overlay_state_version")
      .upsert({
        room_owner_user_id: roomOwnerId,
        version: (currentVersion?.version ?? 0) + 1,
        last_updated_at: new Date().toISOString()
      });

    return NextResponse.json(
      { success: true, message: "Overlay limpo." },
      { status: 200 }
    );
  } catch (caughtError) {
    const messageText =
      caughtError instanceof Error
        ? caughtError.message
        : "Falha ao limpar overlay.";
    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
