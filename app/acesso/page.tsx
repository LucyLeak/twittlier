"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AccessPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const response = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Nao foi possivel validar o acesso.");
      setIsLoading(false);
      return;
    }

    router.replace("/auth");
    router.refresh();
  }

  return (
    <main className="retro-page">
      <section className="retro-window">
        <h1 className="retro-title">Twittlier :: acesso privado</h1>
        <form className="retro-form" onSubmit={onSubmit}>
          <label htmlFor="private-code">Codigo de entrada</label>
          <input
            id="private-code"
            className="retro-input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Digite o codigo compartilhado"
            autoFocus
            required
          />
          {error ? <p className="retro-error">{error}</p> : null}
          <button className="retro-button primary" type="submit" disabled={isLoading}>
            {isLoading ? "Validando..." : "Entrar na rede"}
          </button>
        </form>
        <hr className="retro-sep" />
        <p className="retro-muted">
          So quem tiver esse codigo pode acessar o site e criar conta.
        </p>
      </section>
    </main>
  );
}
