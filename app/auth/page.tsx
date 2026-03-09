"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthMode = "login" | "signup";

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

export default function AuthPage() {
  const router = useRouter();

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [youtubeAccount, setYoutubeAccount] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) {
        router.replace("/");
      }
    });

    return () => {
      active = false;
    };
  }, [router]);

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

    const handleOptions = [
      baseHandle,
      `${baseHandle.slice(0, 20)}${Math.floor(1000 + Math.random() * 9000)}`
    ];

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsLoading(true);
    const supabase = getSupabaseBrowserClient();

    try {
      if (mode === "signup") {
        if (password.length < 6) {
          throw new Error("A senha precisa ter pelo menos 6 caracteres.");
        }

        const cleanHandle = normalizeHandle(handle || email.split("@")[0] || "user");
        const cleanName = normalizeName(name, cleanHandle);
        const cleanYoutubeAccount = youtubeAccount.trim();
        const cleanProfilePhotoUrl = profilePhotoUrl.trim();

        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: cleanName,
              handle: cleanHandle,
              youtube_account: cleanYoutubeAccount || null,
              profile_photo_url: cleanProfilePhotoUrl || null
            }
          }
        });

        if (signUpError) throw signUpError;

        if (data.user && data.session) {
          await ensureAccount(
            data.user.id,
            cleanName,
            cleanHandle,
            cleanYoutubeAccount,
            cleanProfilePhotoUrl
          );
        }

        if (data.session) {
          router.replace("/");
          return;
        }

        setMessage(
          "Conta criada. Se a confirmacao de email estiver ligada no Supabase, confirme seu email para entrar."
        );
        return;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (signInError) throw signInError;

      if (data.user) {
        const fallbackHandle =
          typeof data.user.user_metadata?.handle === "string"
            ? data.user.user_metadata.handle
            : email.split("@")[0];
        const fallbackName =
          typeof data.user.user_metadata?.name === "string"
            ? data.user.user_metadata.name
            : fallbackHandle;
        const fallbackYoutube =
          typeof data.user.user_metadata?.youtube_account === "string"
            ? data.user.user_metadata.youtube_account
            : "";
        const fallbackPhoto =
          typeof data.user.user_metadata?.profile_photo_url === "string"
            ? data.user.user_metadata.profile_photo_url
            : "";

        await ensureAccount(
          data.user.id,
          fallbackName,
          fallbackHandle,
          fallbackYoutube,
          fallbackPhoto
        );
      }

      router.replace("/");
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha na autenticacao.";
      setError(messageText);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="retro-page">
      <section className="retro-window">
        <h1 className="retro-title">Twittlier :: conta</h1>

        <div className="auth-tabs">
          <button
            className="retro-button"
            type="button"
            data-active={mode === "login"}
            onClick={() => setMode("login")}
          >
            Login
          </button>
          <button
            className="retro-button"
            type="button"
            data-active={mode === "signup"}
            onClick={() => setMode("signup")}
          >
            Criar conta
          </button>
        </div>

        <form className="retro-form" onSubmit={onSubmit}>
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            className="retro-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label htmlFor="auth-password">Senha</label>
          <input
            id="auth-password"
            className="retro-input"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          {mode === "signup" ? (
            <>
              <label htmlFor="auth-name">Nome</label>
              <input
                id="auth-name"
                className="retro-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ex: Joao Silva"
              />

              <label htmlFor="auth-handle">@</label>
              <input
                id="auth-handle"
                className="retro-input"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                placeholder="ex: joao_90"
              />

              <label htmlFor="auth-youtube">Conta do YouTube (opcional)</label>
              <input
                id="auth-youtube"
                className="retro-input"
                value={youtubeAccount}
                onChange={(event) => setYoutubeAccount(event.target.value)}
                placeholder="ex: @joaocanal ou URL"
              />

              <label htmlFor="auth-photo">Foto de perfil URL (opcional)</label>
              <input
                id="auth-photo"
                className="retro-input"
                type="url"
                value={profilePhotoUrl}
                onChange={(event) => setProfilePhotoUrl(event.target.value)}
                placeholder="https://..."
              />
            </>
          ) : null}

          {error ? <p className="retro-error">{error}</p> : null}
          {message ? <p className="retro-muted">{message}</p> : null}

          <button className="retro-button primary" type="submit" disabled={isLoading}>
            {isLoading
              ? "Processando..."
              : mode === "login"
                ? "Entrar na conta"
                : "Cadastrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
