"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

type TwittlierBrowserGlobal = typeof globalThis & {
  __twittlierSupabaseBrowserClient?: SupabaseClient;
};

function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ou NEXT_PUBLIC_SUPABASE_ANON_KEY)."
    );
  }

  return { supabaseUrl, supabasePublishableKey };
}

export function getSupabaseBrowserClient() {
  const browserGlobal = globalThis as TwittlierBrowserGlobal;

  if (!browserClient && browserGlobal.__twittlierSupabaseBrowserClient) {
    browserClient = browserGlobal.__twittlierSupabaseBrowserClient;
  }

  if (!browserClient) {
    const { supabaseUrl, supabasePublishableKey } = getSupabaseConfig();
    browserClient = createBrowserClient(supabaseUrl, supabasePublishableKey);
    browserGlobal.__twittlierSupabaseBrowserClient = browserClient;
  }

  return browserClient;
}
