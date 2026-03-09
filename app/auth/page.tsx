"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthMode = "login" | "signup";

function normalizeUsername(source: string) {
  const base = source.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  if (base.length >= 3) return base;
  return `user${Math.floor(1000 + Math.random() * 9000)}`;
}

export default function AuthPage() {
  const router = useRouter();

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
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

  async function ensureProfile(userId: string, candidateUsername: string) {
    const supabase = getSupabaseBrowserClient();
    const usernameValue = normalizeUsername(candidateUsername);
    await supabase.from("profiles").upsert(
      {
        user_id: userId,
        username: usernameValue
      },
      { onConflict: "user_id" }
    );
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

        const cleanUsername = normalizeUsername(username || email.split("@")[0] || "user");
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: cleanUsername
            }
          }
        });

        if (signUpError) throw signUpError;

        if (data.user) {
          await ensureProfile(data.user.id, cleanUsername);
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
        const fallbackName =
          typeof data.user.user_metadata?.username === "string"
            ? data.user.user_metadata.username
            : email.split("@")[0];
        await ensureProfile(data.user.id, fallbackName);
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
              <label htmlFor="auth-username">Nome de usuario</label>
              <input
                id="auth-username"
                className="retro-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="ex: joao_90"
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
