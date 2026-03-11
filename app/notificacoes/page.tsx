"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getSessionUserWithRetry } from "@/lib/session-utils";

type NotificationRecord = {
  id: string;
  recipient_user_id: string;
  actor_user_id: string;
  type: string;
  post_id: string | null;
  read: boolean;
  created_at: string;
};

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadNotifications() {
    setError("");
    const supabase = getSupabaseBrowserClient();
    const { user: sessionUser, error: sessionError } = await getSessionUserWithRetry(supabase);
    if (!sessionUser) {
      if (sessionError) {
        setError(sessionError.message);
      } else {
        setError("Sessao expirada. Faca login novamente.");
      }
      setIsLoading(false);
      router.replace("/auth");
      return;
    }

    const { data, error: notiError } = await supabase
      .from("notifications")
      .select("id, recipient_user_id, actor_user_id, type, post_id, read, created_at")
      .eq("recipient_user_id", sessionUser.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (notiError) {
      setError(notiError.message);
      setIsLoading(false);
      return;
    }

    const list = (data as NotificationRecord[]) ?? [];
    setNotifications(list);

    const actorIds = Array.from(new Set(list.map((n) => n.actor_user_id)));
    if (actorIds.length > 0) {
      const { data: accountsRaw, error: accountsError } = await supabase
        .from("accounts")
        .select("user_id, handle")
        .in("user_id", actorIds);
      if (!accountsError) {
        const mapping: Record<string, string> = {};
        for (const account of (accountsRaw as Array<{ user_id: string; handle: string }>) ?? []) {
          mapping[account.user_id] = account.handle;
        }
        setActors(mapping);
      }
    }

    setIsLoading(false);
  }

  async function markAsRead(notificationId: string) {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", notificationId);
    if (error) {
      setError(error.message);
      return;
    }
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
  }

  useEffect(() => {
    loadNotifications().catch((caughtError) => {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao carregar notificacoes.";
      setError(messageText);
      setIsLoading(false);
    });
  }, []);

  return (
    <main className="tw-page-shell">
      <section className="tw-card">
        <h1 className="tw-section-title">Notificacoes</h1>
        <div className="tw-inline-actions">
          <button className="retro-button" type="button" onClick={() => router.push("/")}>Home</button>
          <button className="retro-button" type="button" onClick={() => router.push("/configuracoes")}>Config</button>
          <button className="retro-button" type="button" onClick={() => router.push("/live")}>Live</button>
        </div>
      </section>

      <section className="tw-card">
        {isLoading ? (
          <p>Carregando notificacoes...</p>
        ) : error ? (
          <p className="retro-error">{error}</p>
        ) : notifications.length === 0 ? (
          <p className="retro-muted">Sem notificacoes no momento.</p>
        ) : (
          <div className="tw-feed-list">
            {notifications.map((notification) => {
              const actorHandle = actors[notification.actor_user_id] || "anon";
              const label =
                notification.type === "like"
                  ? "curtiu seu post"
                  : notification.type === "reply"
                  ? "respondeu seu post"
                  : "interagiu";
              return (
                <article
                  key={notification.id}
                  className={`tw-post-card ${notification.read ? "" : "tw-visible"}`}
                >
                  <div className="tw-post-header">
                    <div>
                      <div className="tw-post-name">@{actorHandle}</div>
                      <div className="tw-post-handle">{label}</div>
                    </div>
                    <time className="post-time">{new Date(notification.created_at).toLocaleString("pt-BR")}</time>
                  </div>
                  <div className="tw-inline-actions">
                    {!notification.read ? (
                      <button
                        className="retro-button tw-small-button"
                        type="button"
                        onClick={() => markAsRead(notification.id)}
                      >
                        Marcar como lido
                      </button>
                    ) : null}
                    {notification.post_id ? (
                      <button
                        className="retro-button tw-small-button"
                        type="button"
                        onClick={() => router.push(`/?post=${notification.post_id}`)}
                      >
                        Ver post
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
