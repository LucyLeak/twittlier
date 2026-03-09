"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AccountRow, ensureAccountExists, getSeedFromUser, normalizeHandle } from "@/lib/account-utils";
import { getSessionUserWithRetry } from "@/lib/session-utils";

type MediaType = "image" | "video" | "gif" | null;
type ModerationStatus = "pending" | "approved" | "rejected";

type LiveMessage = {
  id: string;
  room_owner_user_id: string;
  author_user_id: string;
  content: string | null;
  media_url: string | null;
  media_type: MediaType;
  moderation_status: ModerationStatus;
  moderation_reason: string | null;
  moderated_by_user_id: string | null;
  moderated_at: string | null;
  created_at: string;
};

const LIVE_POLL_MS = 3200;

function getMediaType(file: File): MediaType {
  if (file.type === "image/gif") return "gif";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  return null;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function extractStoragePathFromPublicUrl(url: string, bucketName: string) {
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.slice(index + marker.length));
}

export default function LivePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [origin, setOrigin] = useState("");
  const [overlayMode, setOverlayMode] = useState(false);
  const [requestedHandle, setRequestedHandle] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [viewerAccount, setViewerAccount] = useState<AccountRow | null>(null);
  const [roomOwnerAccount, setRoomOwnerAccount] = useState<AccountRow | null>(null);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<LiveMessage[]>([]);
  const [authorMap, setAuthorMap] = useState<Record<string, AccountRow>>({});
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isModerating, setIsModerating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const canModerateLive = useMemo(() => {
    if (!viewerAccount || !roomOwnerAccount) return false;
    return viewerAccount.is_moderator || viewerAccount.user_id === roomOwnerAccount.user_id;
  }, [viewerAccount, roomOwnerAccount]);

  const visibleMessages = useMemo(() => {
    if (!viewerAccount) return [];
    return messages.filter((message) => {
      if (message.moderation_status === "approved") return true;
      if (overlayMode) return false;
      if (canModerateLive) return true;
      return message.author_user_id === viewerAccount.user_id;
    });
  }, [messages, viewerAccount, canModerateLive, overlayMode]);

  const embedUrl = useMemo(() => {
    if (!origin || !roomOwnerAccount) return "";
    return `${origin}/live?stream=${roomOwnerAccount.handle}&overlay=1`;
  }, [origin, roomOwnerAccount]);

  async function loadRoomMessages(currentRoomOwner: AccountRow, currentViewer: AccountRow) {
    const supabase = getSupabaseBrowserClient();
    const moderationAllowed =
      currentViewer.is_moderator || currentViewer.user_id === currentRoomOwner.user_id;

    const { data: rawMessages, error: messagesError } = await supabase
      .from("live_messages")
      .select(
        "id, room_owner_user_id, author_user_id, content, media_url, media_type, moderation_status, moderation_reason, moderated_by_user_id, moderated_at, created_at"
      )
      .eq("room_owner_user_id", currentRoomOwner.user_id)
      .order("created_at", { ascending: true })
      .limit(250);

    if (messagesError) throw messagesError;
    const typedMessages = (rawMessages as LiveMessage[]) ?? [];
    setMessages(typedMessages);

    const authorIds = Array.from(new Set(typedMessages.map((message) => message.author_user_id)));
    if (authorIds.length > 0) {
      const { data: authorsRaw, error: authorsError } = await supabase
        .from("accounts")
        .select(
          "user_id, name, handle, youtube_account, profile_photo_url, email_verified_optional, email_verified_at, is_moderator"
        )
        .in("user_id", authorIds);

      if (authorsError) throw authorsError;
      const map: Record<string, AccountRow> = {};
      for (const account of (authorsRaw as AccountRow[]) ?? []) {
        map[account.user_id] = account;
      }
      setAuthorMap(map);
    } else {
      setAuthorMap({});
    }

    if (moderationAllowed) {
      const { data: rawPending, error: pendingError } = await supabase
        .from("live_messages")
        .select(
          "id, room_owner_user_id, author_user_id, content, media_url, media_type, moderation_status, moderation_reason, moderated_by_user_id, moderated_at, created_at"
        )
        .eq("room_owner_user_id", currentRoomOwner.user_id)
        .eq("moderation_status", "pending")
        .order("created_at", { ascending: true })
        .limit(100);
      if (pendingError) throw pendingError;
      setPendingMessages((rawPending as LiveMessage[]) ?? []);
    } else {
      setPendingMessages([]);
    }
  }

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      setIsLoading(true);
      setError("");
      setStatus("");
      const supabase = getSupabaseBrowserClient();

      const windowOrigin = typeof window !== "undefined" ? window.location.origin : "";
      setOrigin(windowOrigin);

      const searchParams =
        typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const rawStream = searchParams?.get("stream") || "";
      const normalizedStream = rawStream ? normalizeHandle(rawStream) : "";
      const isOverlay = searchParams?.get("overlay") === "1";
      setRequestedHandle(normalizedStream);
      setOverlayMode(isOverlay);

      const { user: sessionUser, error: sessionError } = await getSessionUserWithRetry(supabase);
      if (!sessionUser) {
        if (sessionError) throw sessionError;
        router.replace("/auth");
        return;
      }

      if (!active) return;
      setUser(sessionUser);

      const ensuredViewer = await ensureAccountExists(supabase, getSeedFromUser(sessionUser));
      if (!active) return;
      setViewerAccount(ensuredViewer);

      let liveRoomOwner = ensuredViewer;
      if (normalizedStream) {
        const { data: targetRaw, error: targetError } = await supabase
          .from("accounts")
          .select(
            "user_id, name, handle, youtube_account, profile_photo_url, email_verified_optional, email_verified_at, is_moderator"
          )
          .eq("handle", normalizedStream)
          .maybeSingle();

        if (targetError) throw targetError;
        if (!targetRaw) {
          throw new Error("Sala de live nao encontrada para esse @.");
        }
        liveRoomOwner = targetRaw as AccountRow;
      }

      if (!active) return;
      setRoomOwnerAccount(liveRoomOwner);
      await loadRoomMessages(liveRoomOwner, ensuredViewer);
    }

    bootstrap()
      .catch((caughtError) => {
        if (!active) return;
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Falha ao carregar sala de live.";
        setError(messageText);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        router.replace("/auth");
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!roomOwnerAccount || !viewerAccount) return;
    let active = true;
    const interval = setInterval(() => {
      loadRoomMessages(roomOwnerAccount, viewerAccount).catch((caughtError) => {
        if (!active) return;
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Falha ao atualizar mensagens.";
        setError(messageText);
      });
    }, LIVE_POLL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [roomOwnerAccount, viewerAccount]);

  useEffect(() => {
    if (!file) {
      setFilePreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(file);
    setFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;
    if (!selected.type.startsWith("image/") && !selected.type.startsWith("video/")) {
      setError("Formato de midia invalido.");
      return;
    }
    if (selected.size > 20 * 1024 * 1024) {
      setError("A midia precisa ter no maximo 20MB.");
      return;
    }
    setError("");
    setFile(selected);
  }

  function clearSelectedFile() {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function uploadLiveMedia(userId: string) {
    if (!file) return { mediaUrl: null as string | null, mediaType: null as MediaType };
    const mediaType = getMediaType(file);
    if (!mediaType) throw new Error("Formato de midia nao suportado.");
    const supabase = getSupabaseBrowserClient();
    const extension = file.name.split(".").pop() || "bin";
    const filePath = `${userId}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("live-media")
      .upload(filePath, file, { upsert: false, contentType: file.type });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("live-media").getPublicUrl(filePath);
    return { mediaUrl: data.publicUrl, mediaType };
  }

  async function submitLiveMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (!user || !viewerAccount || !roomOwnerAccount) {
      setError("Sessao invalida. Atualize a pagina.");
      return;
    }

    const cleanText = text.trim();
    if (!cleanText && !file) {
      setError("Digite algo ou anexe uma midia.");
      return;
    }

    setIsSending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { mediaUrl, mediaType } = await uploadLiveMedia(user.id);
      const moderationStatus: ModerationStatus = mediaUrl ? "pending" : "approved";

      const { error: insertError } = await supabase.from("live_messages").insert({
        room_owner_user_id: roomOwnerAccount.user_id,
        author_user_id: viewerAccount.user_id,
        content: cleanText || null,
        media_url: mediaUrl,
        media_type: mediaType,
        moderation_status: moderationStatus
      });
      if (insertError) throw insertError;

      setText("");
      clearSelectedFile();
      setStatus(
        moderationStatus === "pending"
          ? "Mensagem enviada. Midia aguardando aprovacao de moderador."
          : "Mensagem publicada."
      );
      await loadRoomMessages(roomOwnerAccount, viewerAccount);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Erro ao enviar mensagem.";
      setError(messageText);
    } finally {
      setIsSending(false);
    }
  }

  async function moderateMessage(message: LiveMessage, approved: boolean) {
    if (!viewerAccount || !roomOwnerAccount || !canModerateLive) return;
    setStatus("");
    setError("");
    setIsModerating(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (approved) {
        const { error: approveError } = await supabase
          .from("live_messages")
          .update({
            moderation_status: "approved",
            moderation_reason: null,
            moderated_by_user_id: viewerAccount.user_id,
            moderated_at: new Date().toISOString()
          })
          .eq("id", message.id)
          .eq("room_owner_user_id", roomOwnerAccount.user_id);
        if (approveError) throw approveError;
        setStatus("Midia aprovada e publicada no chat da live.");
      } else {
        if (message.media_url) {
          const filePath = extractStoragePathFromPublicUrl(message.media_url, "live-media");
          if (filePath) {
            const { error: removeError } = await supabase.storage
              .from("live-media")
              .remove([filePath]);
            if (
              removeError &&
              !removeError.message.toLowerCase().includes("not found")
            ) {
              throw removeError;
            }
          }
        }

        const { error: rejectError } = await supabase
          .from("live_messages")
          .update({
            moderation_status: "rejected",
            moderation_reason: "Conteudo improprio para a live.",
            media_url: null,
            media_type: null,
            moderated_by_user_id: viewerAccount.user_id,
            moderated_at: new Date().toISOString()
          })
          .eq("id", message.id)
          .eq("room_owner_user_id", roomOwnerAccount.user_id);
        if (rejectError) throw rejectError;

        setStatus("Midia rejeitada e removida do chat.");
      }

      await loadRoomMessages(roomOwnerAccount, viewerAccount);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao moderar conteudo.";
      setError(messageText);
    } finally {
      setIsModerating(false);
    }
  }

  if (isLoading) {
    return (
      <main className="tw-page-shell">
        <section className="tw-card">
          <h1 className="tw-section-title">Live</h1>
          <p>Carregando chat da live...</p>
        </section>
      </main>
    );
  }

  if (overlayMode) {
    return (
      <main className="tw-live-overlay">
        <div className="tw-live-feed">
          {visibleMessages.map((message) => {
            if (message.moderation_status !== "approved") return null;
            const author = authorMap[message.author_user_id];
            return (
              <article className="tw-live-message" key={message.id}>
                <header className="tw-live-message-head">
                  <strong className="tw-live-author">@{author?.handle || "anon"}</strong>
                  <time className="tw-live-time">
                    {new Date(message.created_at).toLocaleTimeString("pt-BR")}
                  </time>
                </header>
                {message.content ? <p className="tw-live-content">{message.content}</p> : null}
                {message.media_url && message.media_type === "video" ? (
                  <video className="tw-live-media" src={message.media_url} controls />
                ) : null}
                {message.media_url && message.media_type !== "video" ? (
                  <img className="tw-live-media" src={message.media_url} alt="Midia da live" />
                ) : null}
              </article>
            );
          })}
        </div>
      </main>
    );
  }

  return (
    <main className="tw-page-shell">
      <section className="tw-card">
        <h1 className="tw-section-title">Live Chat</h1>
        <div className="tw-inline-actions">
          <button className="retro-button" type="button" onClick={() => router.push("/")}>
            Voltar ao feed
          </button>
          {roomOwnerAccount?.handle ? (
            <button
              className="retro-button"
              type="button"
              onClick={() => router.push(`/perfil/${roomOwnerAccount.handle}`)}
            >
              Ver perfil da live
            </button>
          ) : null}
        </div>
        <p className="retro-muted">
          Sala atual: @{roomOwnerAccount?.handle || "sem-handle"}
          {requestedHandle ? " (acesso por stream)" : " (sua sala)"}
        </p>
        <p className="retro-muted">
          URL para OBS overlay:{" "}
          <code className="tw-live-code">{embedUrl || "carregando..."}</code>
        </p>
      </section>

      <section className="tw-card">
        <h2 className="tw-section-title">Enviar mensagem da live</h2>
        <form className="retro-form" onSubmit={submitLiveMessage}>
          <textarea
            className="tw-composer-input"
            placeholder="Mensagem para o chat da live..."
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="tw-composer-toolbar">
            <input
              ref={fileInputRef}
              id="live-media-file"
              className="tw-file-input-hidden"
              type="file"
              accept="image/*,video/*,.gif"
              onChange={onFileChange}
            />
            <label
              htmlFor="live-media-file"
              className="tw-upload-box"
              data-has-file={file ? "true" : "false"}
            >
              <span className="tw-upload-title">
                {file ? "Midia selecionada" : "Adicionar midia para live"}
              </span>
              <span className="tw-upload-meta">
                {file ? `${file.name} (${formatBytes(file.size)})` : "Clique para escolher"}
              </span>
            </label>
            {file ? (
              <button className="retro-button tw-small-button" type="button" onClick={clearSelectedFile}>
                Remover
              </button>
            ) : null}
          </div>
          {filePreviewUrl ? (
            file?.type.startsWith("video/") ? (
              <video className="tw-live-media" src={filePreviewUrl} controls />
            ) : (
              <img className="tw-live-media" src={filePreviewUrl} alt="Previa da midia da live" />
            )
          ) : null}
          <button className="retro-button primary" type="submit" disabled={isSending}>
            {isSending ? "Enviando..." : "Enviar no chat"}
          </button>
        </form>
        {status ? <p className="retro-muted">{status}</p> : null}
        {error ? <p className="retro-error">{error}</p> : null}
      </section>

      <section className="tw-card">
        <h2 className="tw-section-title">Mensagens ao vivo</h2>
        <div className="tw-live-feed">
          {visibleMessages.length === 0 ? (
            <p className="retro-muted">Sem mensagens ainda.</p>
          ) : (
            visibleMessages.map((message) => {
              const author = authorMap[message.author_user_id];
              const isOwnMessage = message.author_user_id === viewerAccount?.user_id;
              const isRejectedOwn = isOwnMessage && message.moderation_status === "rejected";
              const isPendingOwn = isOwnMessage && message.moderation_status === "pending";

              return (
                <article
                  className={`tw-live-message ${message.moderation_status}`}
                  key={message.id}
                >
                  <header className="tw-live-message-head">
                    <strong className="tw-live-author">@{author?.handle || "anon"}</strong>
                    <time className="tw-live-time">
                      {new Date(message.created_at).toLocaleTimeString("pt-BR")}
                    </time>
                  </header>

                  {isPendingOwn ? (
                    <p className="retro-muted">Aguardando aprovacao de moderador...</p>
                  ) : null}
                  {isRejectedOwn ? (
                    <p className="retro-error">
                      Conteudo improprio para a live. Sua midia foi removida.
                    </p>
                  ) : null}

                  {message.content ? <p className="tw-live-content">{message.content}</p> : null}
                  {message.media_url && message.media_type === "video" ? (
                    <video className="tw-live-media" src={message.media_url} controls />
                  ) : null}
                  {message.media_url && message.media_type !== "video" ? (
                    <img className="tw-live-media" src={message.media_url} alt="Midia da live" />
                  ) : null}

                  {message.moderation_status !== "approved" && canModerateLive ? (
                    <p className="retro-muted">
                      Estado: {message.moderation_status}
                      {message.moderation_reason ? ` | ${message.moderation_reason}` : ""}
                    </p>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </section>

      {canModerateLive ? (
        <section className="tw-card">
          <h2 className="tw-section-title">Fila de moderacao de midia</h2>
          {pendingMessages.length === 0 ? (
            <p className="retro-muted">Nao ha midias pendentes agora.</p>
          ) : (
            <div className="tw-live-pending-list">
              {pendingMessages.map((message) => {
                const author = authorMap[message.author_user_id];
                return (
                  <article className="tw-live-message pending" key={message.id}>
                    <p className="tw-live-content">
                      <strong>@{author?.handle || "anon"}</strong>{" "}
                      {message.content ? `| ${message.content}` : ""}
                    </p>
                    {message.media_url && message.media_type === "video" ? (
                      <video className="tw-live-media" src={message.media_url} controls />
                    ) : null}
                    {message.media_url && message.media_type !== "video" ? (
                      <img className="tw-live-media" src={message.media_url} alt="Midia pendente" />
                    ) : null}
                    <div className="tw-inline-actions">
                      <button
                        className="retro-button primary"
                        type="button"
                        disabled={isModerating}
                        onClick={() => moderateMessage(message, true)}
                      >
                        Aprovar
                      </button>
                      <button
                        className="retro-button danger"
                        type="button"
                        disabled={isModerating}
                        onClick={() => moderateMessage(message, false)}
                      >
                        Rejeitar
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
