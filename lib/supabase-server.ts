import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { assertSupabaseClientConfig } from "@/lib/supabase-config";

export async function getRouteSupabaseClient() {
  const { supabaseUrl, supabasePublishableKey } = assertSupabaseClientConfig();

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {
        // Route handlers only need read access for auth session.
      },
      remove() {
        // Route handlers only need read access for auth session.
      }
    }
  });
}
