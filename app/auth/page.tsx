"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  ensureAccountExists,
  getSeedFromUser,
  normalizeHandle,
  normalizeName
} from "@/lib/account-utils";

type AuthMode = "login" | "signup";

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

    supabase.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setError(sessionError.message);
        return;
      }

      if (!data.session?.user) return;

      try {
        await ensureAccountExists(supabase, getSeedFromUser(data.session.user));
        router.replace("/");
      } catch (caughtError) {
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Falha ao montar conta.";
        setError(messageText);
      }
    });

    return () => {
      active = false;
    };
  }, [router]);

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

        const registerResponse = await fetch("/api/auth/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email,
            password,
            name: cleanName,
            handle: cleanHandle,
            youtubeAccount: cleanYoutubeAccount || null,
            profilePhotoUrl: cleanProfilePhotoUrl || null
          })
        });

        const registerPayload = (await registerResponse
          .json()
          .catch(() => null)) as { error?: string } | null;

        if (!registerResponse.ok) {
          throw new Error(registerPayload?.error || "Falha ao criar conta.");
        }

        const { data, error: signInAfterRegisterError } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (signInAfterRegisterError) throw signInAfterRegisterError;
        if (!data.user) {
          throw new Error("Conta criada, mas nao foi possivel iniciar sessao.");
        }

        await ensureAccountExists(supabase, {
          ...getSeedFromUser(data.user),
          name: cleanName,
          handle: cleanHandle,
          youtubeAccount: cleanYoutubeAccount,
          profilePhotoUrl: cleanProfilePhotoUrl
        });

        router.replace("/");
        return;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (signInError) throw signInError;
      if (!data.user) {
        throw new Error("Nao foi possivel carregar usuario da sessao.");
      }

      await ensureAccountExists(supabase, getSeedFromUser(data.user));
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
                placeholder="ex: @meucanal ou URL"
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

          {message ? <p className="retro-muted">{message}</p> : null}
          {error ? <p className="retro-error">{error}</p> : null}

          <button className="retro-button primary" type="submit" disabled={isLoading}>
            {isLoading ? "Processando..." : mode === "login" ? "Entrar" : "Cadastrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
