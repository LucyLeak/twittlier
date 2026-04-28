export function resolveSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
}

export function resolveSupabasePublishableKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    ""
  );
}

export function assertSupabaseClientConfig() {
  const supabaseUrl = resolveSupabaseUrl();
  const supabasePublishableKey = resolveSupabasePublishableKey();

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Defina NEXT_PUBLIC_SUPABASE_URL (ou SUPABASE_URL) e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ou NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY)."
    );
  }

  return { supabaseUrl, supabasePublishableKey };
}
