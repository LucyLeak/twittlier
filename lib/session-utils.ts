import { AuthError, SupabaseClient, User } from "@supabase/supabase-js";

type SessionResult = {
  user: User | null;
  error: Error | null;
};

let inFlightSessionRequest: Promise<SessionResult> | null = null;
const SESSION_TIMEOUT_MESSAGE = "Conexao lenta ao validar sessao. Tente novamente em instantes.";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toError(caughtError: unknown, fallback: string) {
  if (caughtError instanceof Error) return caughtError;
  return new Error(fallback);
}

function isSessionMissingError(error: Error | AuthError | null) {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return message.includes("auth session missing") || message.includes("session_not_found");
}

export function isSessionLockError(error: Error | AuthError | null) {
  if (!error) return false;
  const message = error.message.toLowerCase();

  return (
    error.name === "AbortError" ||
    (message.includes("lock") &&
      (message.includes("steal") ||
        message.includes("another request") ||
        message.includes("navigator.locks") ||
        message.includes("broken by another request")))
  );
}

export function isSessionTimeoutError(error: Error | AuthError | null) {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("tempo limite ao validar sessao") ||
    message.includes("conexao lenta ao validar sessao") ||
    message.includes("timeout")
  );
}

async function waitForInitialAuthState(
  supabase: SupabaseClient,
  timeoutMs: number
): Promise<SessionResult> {
  return new Promise((resolve) => {
    let settled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    const finish = (result: SessionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      subscription?.unsubscribe();
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      finish({ user: null, error: null });
    }, timeoutMs);

    const listener = supabase.auth.onAuthStateChange((_event, session) => {
      finish({ user: session?.user ?? null, error: null });
    });

    subscription = listener.data.subscription;
  });
}

async function getSessionUserOnce(supabase: SupabaseClient): Promise<SessionResult> {
  let lastError: Error | null = null;

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      lastError = error;
    } else if (data.session?.user) {
      return { user: data.session.user, error: null };
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
      lastError = userError;
    } else if (userData.user) {
      return { user: userData.user, error: null };
    }
  } catch (caughtError) {
    lastError = toError(caughtError, "Falha inesperada ao consultar sessao.");
  }

  return { user: null, error: lastError };
}

async function runSessionUserWithRetry(
  supabase: SupabaseClient,
  retries: number,
  delayMs: number
): Promise<SessionResult> {
  let lastError: Error | null = null;

  for (let index = 0; index < retries; index += 1) {
    const result = await getSessionUserOnce(supabase);
    if (result.user) {
      return result;
    }

    lastError = result.error;
    if (index >= retries - 1) {
      break;
    }

    if (lastError && !isSessionMissingError(lastError) && !isSessionLockError(lastError)) {
      break;
    }

    await wait(delayMs);
  }

  if (!lastError || isSessionMissingError(lastError) || isSessionLockError(lastError)) {
    const authStateResult = await waitForInitialAuthState(
      supabase,
      Math.max(900, delayMs * Math.max(2, retries) * 2)
    );

    if (authStateResult.user) {
      return authStateResult;
    }
  }

  return { user: null, error: lastError };
}

export async function getSessionUserWithRetry(
  supabase: SupabaseClient,
  retries = 3,
  delayMs = 280,
  timeoutMs = 12000
): Promise<SessionResult> {
  if (inFlightSessionRequest) {
    return inFlightSessionRequest;
  }

  const currentRequest = runSessionUserWithRetry(supabase, retries, delayMs);
  const shouldTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutRequest = shouldTimeout
    ? new Promise<SessionResult>((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({
            user: null,
            error: new Error(SESSION_TIMEOUT_MESSAGE)
          });
        }, timeoutMs);
      })
    : null;

  const wrappedRequest = timeoutRequest
    ? Promise.race([currentRequest, timeoutRequest])
    : currentRequest;

  inFlightSessionRequest = wrappedRequest;

  try {
    return await wrappedRequest;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (inFlightSessionRequest === wrappedRequest) {
      inFlightSessionRequest = null;
    }
  }
}
