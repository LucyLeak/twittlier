"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;
const DEFAULT_FETCH_TIMEOUT_MS = 8000;
const AUTH_FETCH_TIMEOUT_MS = 10000;
const STORAGE_FETCH_TIMEOUT_MS = 30000;

type TwittlierBrowserGlobal = typeof globalThis & {
  __twittlierSupabaseBrowserClient?: SupabaseClient;
};

function resolveFetchTimeout(input: RequestInfo | URL) {
  try {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : "";
    if (url.includes("/storage/v1/")) return STORAGE_FETCH_TIMEOUT_MS;
    if (url.includes("/auth/v1/")) return AUTH_FETCH_TIMEOUT_MS;
  } catch {
    return DEFAULT_FETCH_TIMEOUT_MS;
  }
  return DEFAULT_FETCH_TIMEOUT_MS;
}

function createTimeoutFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const timeoutMs = resolveFetchTimeout(input);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (init?.signal) {
      if (init.signal.aborted) {
        controller.abort();
      } else {
        init.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

const timeoutFetch = createTimeoutFetch();

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
    browserClient = createBrowserClient(supabaseUrl, supabasePublishableKey, {
      global: { fetch: timeoutFetch }
    });
    browserGlobal.__twittlierSupabaseBrowserClient = browserClient;
  }

  return browserClient;
}
