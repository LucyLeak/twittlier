"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AccountSettings = {
  name: string;
  handle: string;
  youtube_account: string | null;
  profile_photo_url: string | null;
  email_verified_optional: boolean;
  email_verified_at: string | null;
};

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

function getDisplayDate(value: string | null) {
  if (!value) return "Nao confirmado";
  return new Date(value).toLocaleString("pt-BR");
}

export default function SettingsPage() {
  const router = useRouter();
  const alreadyMarkedRef = useRef(false);

  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<AccountSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function ensureLogged() {
    const supabase = getSupabaseBrowserClient();
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session?.user) {
      router.replace("/auth");
      return null;
    }
    return data.session.user;
  }

  async function ensureAccountForUser(currentUser: User) {
    const supabase = getSupabaseBrowserClient();
    const metadata = currentUser.user_metadata ?? {};
    const fallbackEmailName = currentUser.email?.split("@")[0] || "user";

    const candidateHandle =
      typeof metadata.handle === "string" ? metadata.handle : fallbackEmailName;
    const candidateName =
      typeof metadata.name === "string" ? metadata.name : fallbackEmailName;
    const candidateYoutube =
      typeof metadata.youtube_account === "string" ? metadata.youtube_account : "";
    const candidatePhoto =
      typeof metadata.profile_photo_url === "string" ? metadata.profile_photo_url : "";

    const cleanHandle = normalizeHandle(candidateHandle);
    const cleanName = normalizeName(candidateName, cleanHandle);
    const cleanYoutube = candidateYoutube.trim() || null;
    const cleanPhoto = candidatePhoto.trim() || null;

    const handleOptions = [cleanHandle];
    for (let index = 0; index < 5; index += 1) {
      const suffix = `${Math.floor(10000 + Math.random() * 90000)}`;
      handleOptions.push(`${cleanHandle.slice(0, 19)}${suffix}`.slice(0, 24));
    }

    for (const handleOption of handleOptions) {
      const { error: upsertError } = await supabase.from("accounts").upsert(
        {
          user_id: currentUser.id,
          name: cleanName,
          handle: handleOption,
          youtube_account: cleanYoutube,
          profile_photo_url: cleanPhoto
        },
        { onConflict: "user_id" }
      );

      if (!upsertError) return;
      if (upsertError.code !== "23505") throw upsertError;
    }

    throw new Error("Nao foi possivel preparar sua conta.");
  }

  async function loadAccount(userId: string) {
    const supabase = getSupabaseBrowserClient();
    const { data, error: selectError } = await supabase
      .from("accounts")
      .select(
        "name, handle, youtube_account, profile_photo_url, email_verified_optional, email_verified_at"
      )
      .eq("user_id", userId)
      .single();

    if (selectError) throw selectError;
    setAccount(data as AccountSettings);
  }

  useEffect(() => {
    let active = true;

    ensureLogged()
      .then(async (currentUser) => {
        if (!active || !currentUser) return;

        setUser(currentUser);
        await ensureAccountForUser(currentUser);

        const shouldMarkEmail =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("email_confirmed") === "1";
        if (shouldMarkEmail && !alreadyMarkedRef.current) {
          alreadyMarkedRef.current = true;
          const supabase = getSupabaseBrowserClient();
          const { error: updateError } = await supabase
            .from("accounts")
            .update({
              email_verified_optional: true,
              email_verified_at: new Date().toISOString()
            })
            .eq("user_id", currentUser.id);

          if (updateError) {
            throw updateError;
          }

          setStatus("Email confirmado com sucesso.");
          router.replace("/configuracoes");
        }

        await loadAccount(currentUser.id);
      })
      .catch((caughtError) => {
        if (!active) return;
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Erro ao carregar configuracoes.";
        setError(messageText);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router]);

  async function sendConfirmationEmail() {
    setError("");
    setStatus("");

    if (!user?.email) {
      setError("Nao foi possivel identificar o email da conta.");
      return;
    }

    setIsSending(true);
    try {
      const redirectTo = `${window.location.origin}/configuracoes?email_confirmed=1`;
      const supabase = getSupabaseBrowserClient();
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: user.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectTo
        }
      });

      if (sendError) throw sendError;

      setStatus("Email enviado. Abra sua caixa de entrada e clique no link para confirmar.");
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Nao foi possivel enviar o email.";
      setError(messageText);
    } finally {
      setIsSending(false);
    }
  }

  if (isLoading) {
    return (
      <main className="retro-page">
        <section className="retro-window">
          <h1 className="retro-title">Twittlier :: configuracoes</h1>
          <p>Carregando configuracoes...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="retro-page">
      <section className="retro-window">
        <h1 className="retro-title">Twittlier :: configuracoes</h1>
        <div className="retro-row">
          <button className="retro-button" type="button" onClick={() => router.push("/")}>
            Voltar ao feed
          </button>
        </div>
      </section>

      <section className="retro-window">
        <h2 className="retro-title">Conta</h2>
        <p>
          <strong>Nome:</strong> {account?.name || "Nao definido"}
        </p>
        <p>
          <strong>@:</strong> {account?.handle ? `@${account.handle}` : "Nao definido"}
        </p>
        <p>
          <strong>YouTube:</strong> {account?.youtube_account || "Nao definido"}
        </p>
        <p>
          <strong>Email da sessao:</strong> {user?.email || "Nao definido"}
        </p>
      </section>

      <section className="retro-window">
        <h2 className="retro-title">Confirmacao opcional de email</h2>
        <p className="retro-muted">
          Seu login funciona sem confirmacao obrigatoria. Se quiser confirmar depois, use o botao
          abaixo.
        </p>
        <p>
          <strong>Status:</strong>{" "}
          {account?.email_verified_optional ? "Confirmado" : "Pendente"}
        </p>
        <p>
          <strong>Data:</strong> {getDisplayDate(account?.email_verified_at || null)}
        </p>
        <button
          className="retro-button primary"
          type="button"
          disabled={isSending}
          onClick={sendConfirmationEmail}
        >
          {isSending ? "Enviando..." : "Confirmar email"}
        </button>
        {status ? <p className="retro-muted">{status}</p> : null}
        {error ? <p className="retro-error">{error}</p> : null}
      </section>
    </main>
  );
}
