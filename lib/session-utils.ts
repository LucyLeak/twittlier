import { AuthError, SupabaseClient, User } from "@supabase/supabase-js";

type SessionResult = {
  user: User | null;
  error: Error | null;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSessionMissingError(error: Error | AuthError | null) {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return message.includes("auth session missing") || message.includes("session_not_found");
}

export async function getSessionUserWithRetry(
  supabase: SupabaseClient,
  retries = 3,
  delayMs = 280
): Promise<SessionResult> {
  let lastError: Error | null = null;

  for (let index = 0; index < retries; index += 1) {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (!isSessionMissingError(error)) {
          lastError = error;
        }
      } else if (data.session?.user) {
        return { user: data.session.user, error: null };
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        if (!isSessionMissingError(userError)) {
          lastError = userError;
        }
      } else if (userData.user) {
        return { user: userData.user, error: null };
      }

      if (index < retries - 1) {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError && !isSessionMissingError(refreshError)) {
          lastError = refreshError;
        }
      }
    } catch (caughtError) {
      lastError =
        caughtError instanceof Error
          ? caughtError
          : new Error("Falha inesperada ao consultar sessao.");
    }

    if (index < retries - 1) {
      await wait(delayMs);
    }
  }

  return { user: null, error: lastError };
}
