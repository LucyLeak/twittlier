"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

function normalizeHandle(source: string) {
  const base = source.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  if (base.length >= 3) return base;
  return `user${Math.floor(1000 + Math.random() * 9000)}`;
}

function normalizeName(source: string, fallbackHandle: string) {
  const clean = source.trim().slice(0, 60);
  if (clean.length > 0) return clean;
  return fallbackHandle;
}

function getAuthRedirectUrl() {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth`;
  }

  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredSiteUrl) {
    return `${configuredSiteUrl.replace(/\/+$/, "")}/auth`;
  }

  return undefined;
}

export default function AuthPage() {
  const router = useRouter();

  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function ensureAccount(
    userId: string,
    candidateName: string,
    candidateHandle: string,
    candidateYoutubeAccount?: string,
    candidateProfilePhotoUrl?: string
  ) {
    const supabase = getSupabaseBrowserClient();
    const baseHandle = normalizeHandle(candidateHandle);
    const accountName = normalizeName(candidateName, baseHandle);
    const youtubeValue = candidateYoutubeAccount?.trim() || null;
    const photoValue = candidateProfilePhotoUrl?.trim() || null;

    const handleOptions = [baseHandle];
    for (let index = 0; index < 5; index += 1) {
      const suffix = `${Math.floor(10000 + Math.random() * 90000)}`;
      handleOptions.push(`${baseHandle.slice(0, 19)}${suffix}`.slice(0, 24));
    }

    for (const handleOption of handleOptions) {
      const { error: upsertError } = await supabase.from("accounts").upsert(
        {
          user_id: userId,
          name: accountName,
          handle: handleOption,
          youtube_account: youtubeValue,
          profile_photo_url: photoValue
        },
        { onConflict: "user_id" }
      );

      if (!upsertError) return;

      if (upsertError.code !== "23505") {
        throw upsertError;
      }
    }

    throw new Error("Nao foi possivel reservar um @ unico para a conta.");
  }

  async function ensureAccountFromUser(user: User) {
    const metadata = user.user_metadata ?? {};
    const fallbackEmailName = user.email?.split("@")[0] || "usuario";

    const candidateHandle =
      typeof metadata.user_name === "string"
        ? metadata.user_name
        : typeof metadata.preferred_username === "string"
          ? metadata.preferred_username
          : fallbackEmailName;

    const candidateName =
      typeof metadata.full_name === "string"
        ? metadata.full_name
        : typeof metadata.name === "string"
          ? metadata.name
          : fallbackEmailName;

    const candidateYoutube =
      typeof metadata.youtube_account === "string" ? metadata.youtube_account : "";

    const candidatePhoto =
      typeof metadata.avatar_url === "string"
        ? metadata.avatar_url
        : typeof metadata.picture === "string"
          ? metadata.picture
          : "";

    await ensureAccount(
      user.id,
      candidateName,
      candidateHandle,
      candidateYoutube,
      candidatePhoto
    );
  }

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    supabase.auth
      .getSession()
      .then(async ({ data, error: sessionError }) => {
        if (!active) return;

        if (sessionError) {
          setError(sessionError.message);
          return;
        }

        if (!data.session?.user) {
          return;
        }

        try {
          await ensureAccountFromUser(data.session.user);
          router.replace("/");
        } catch (caughtError) {
          const messageText =
            caughtError instanceof Error ? caughtError.message : "Falha ao montar conta.";
          setError(messageText);
        }
      })
      .finally(() => {
        if (active) {
          setIsCheckingSession(false);
          setIsGoogleLoading(false);
        }
      });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active || !session?.user) return;

      try {
        await ensureAccountFromUser(session.user);
        router.replace("/");
      } catch (caughtError) {
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Falha ao montar conta.";
        setError(messageText);
        setIsGoogleLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  async function signInWithGoogle() {
    setError("");
    setMessage("");
    setIsGoogleLoading(true);
    const supabase = getSupabaseBrowserClient();

    try {
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getAuthRedirectUrl()
        }
      });

      if (oauthError) throw oauthError;

      if (data.url) {
        window.location.assign(data.url);
        return;
      }

      setMessage("Abrindo login do Google...");
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha na autenticacao.";
      setError(messageText);
      setIsGoogleLoading(false);
    }
  }

  if (isCheckingSession) {
    return (
      <main className="retro-page">
        <section className="retro-window">
          <h1 className="retro-title">Twittlier :: conta</h1>
          <p>Validando sessao...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="retro-page">
      <section className="retro-window">
        <h1 className="retro-title">Twittlier :: conta</h1>
        <div className="retro-form">
          <p>Login liberado apenas com Google.</p>
          <button
            className="retro-button primary"
            type="button"
            onClick={signInWithGoogle}
            disabled={isGoogleLoading}
          >
            {isGoogleLoading ? "Redirecionando..." : "Entrar com Google"}
          </button>
          {message ? <p className="retro-muted">{message}</p> : null}
          {error ? <p className="retro-error">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
