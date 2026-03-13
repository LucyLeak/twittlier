"use client";

import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  author_handle?: string | null;
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
const OVERLAY_MAX_MESSAGES = 5;
const LIVE_RETENTION_HOURS = 6;
const LIVE_MAX_MESSAGES = 200;
const LIVE_MAX_PENDING = 80;
const LIVE_CLEANUP_COOLDOWN_MS = 5 * 60 * 1000;

type OverlayApiMessage = {
  id: string;
  author_user_id: string;
  author_handle: string;
  content: string | null;
  media_url: string | null;
  media_type: MediaType;
  created_at: string;
};

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
  const lastCleanupRef = useRef(0);
  const overlayFeedRef = useRef<HTMLDivElement | null>(null);

  const [origin, setOrigin] = useState("");
  const [overlayMode, setOverlayMode] = useState(false);
  const [requestedHandle, setRequestedHandle] = useState("");
  const [overlayAccessKey, setOverlayAccessKey] = useState("");
  const [roomHandle, setRoomHandle] = useState("");
  const [roomHandleInput, setRoomHandleInput] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [viewerAccount, setViewerAccount] = useState<AccountRow | null>(null);
  const [roomOwnerAccount, setRoomOwnerAccount] = useState<AccountRow | null>(null);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<LiveMessage[]>([]);
  const [authorMap, setAuthorMap] = useState<Record<string, AccountRow>>({});
  const [text, setText] = useState("");
  const [shareInput, setShareInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isModerating, setIsModerating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const canModerateLive = useMemo(() => {
    if (!viewerAccount) return false;
    return viewerAccount.is_moderator;
  }, [viewerAccount]);

  const visibleMessages = useMemo(() => {
    if (overlayMode) {
      return messages
        .filter((message) => message.moderation_status === "approved")
        .slice(-OVERLAY_MAX_MESSAGES);
    }
    if (!viewerAccount) return [];
    return messages.filter((message) => {
      if (message.moderation_status === "approved") return true;
      if (overlayMode) return false;
      if (canModerateLive) return true;
      return message.author_user_id === viewerAccount.user_id;
    });
  }, [messages, viewerAccount, canModerateLive, overlayMode]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!overlayMode) return;

    document.documentElement.classList.add("tw-overlay-html");
    document.body.classList.add("tw-overlay-body");
    return () => {
      document.documentElement.classList.remove("tw-overlay-html");
      document.body.classList.remove("tw-overlay-body");
    };
  }, [overlayMode]);

  const embedUrl = useMemo(() => {
    if (!origin || !roomOwnerAccount) return "";
    return `${origin}/live?stream=${roomOwnerAccount.handle}&overlay=1&key=SUA_CHAVE_OVERLAY`;
  }, [origin, roomOwnerAccount]);

  function normalizePostShareLink(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return "";

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }

    if (trimmed.startsWith("/post/")) {
      return origin ? `${origin}${trimmed}` : trimmed;
    }

    const uuidMatch = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidMatch.test(trimmed)) {
      return origin ? `${origin}/post/${trimmed}` : `/post/${trimmed}`;
    }

    return trimmed;
  }

  function appendPostLinkToMessage() {
    const link = normalizePostShareLink(shareInput);
    if (!link) {
      setError("Informe o link ou ID do post para compartilhar.");
      return;
    }
    setText((current) => (current ? `${current}\n${link}` : link));
    setShareInput("");
    setStatus("Link do post adicionado na mensagem.");
  }

  function openPostFromShareInput() {
    const link = normalizePostShareLink(shareInput);
    if (!link) {
      setError("Informe o link ou ID do post para abrir.");
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  }

  function renderLiveContent(content: string) {
    const parts: ReactNode[] = [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = urlRegex.exec(content)) !== null) {
      const index = match.index;
      if (index > lastIndex) {
        parts.push(content.slice(lastIndex, index));
      }
      const url = match[0];
      parts.push(
        <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      );
      lastIndex = index + url.length;
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts;
  }

  async function loadOverlayMessages(streamHandle: string, key: string) {
    const response = await fetch(
      `/api/live-overlay?stream=${encodeURIComponent(streamHandle)}&key=${encodeURIComponent(key)}`,
      { cache: "no-store" }
    );
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          roomOwner?: { user_id: string; handle: string; name?: string | null };
          messages?: OverlayApiMessage[];
        }
      | null;

    if (!response.ok) {
      throw new Error(payload?.error || "Falha ao carregar overlay da live.");
    }

    const mappedMessages: LiveMessage[] = (payload?.messages ?? []).map((message) => ({
      id: message.id,
      room_owner_user_id: payload?.roomOwner?.user_id || "",
      author_user_id: message.author_user_id,
      author_handle: message.author_handle,
      content: message.content,
      media_url: message.media_url,
      media_type: message.media_type,
      moderation_status: "approved",
      moderation_reason: null,
      moderated_by_user_id: null,
      moderated_at: null,
      created_at: message.created_at
    }));

    setMessages(mappedMessages);
    setPendingMessages([]);
    setAuthorMap({});
  }

  async function fetchRoomOwnerByHandle(handle: string) {
    const supabase = getSupabaseBrowserClient();
    const normalized = normalizeHandle(handle);
    const { data: account, error } = await supabase
      .from("accounts")
      .select(
        "user_id, name, handle, youtube_account, profile_photo_url, theme_preference, notifications_enabled, email_verified_optional, email_verified_at, is_moderator"
      )
      .eq("handle", normalized)
      .maybeSingle();

    if (error) throw error;
    return (account as AccountRow | null) ?? null;
  }

  async function switchRoomHandle(
    newHandle: string,
    currentViewer: AccountRow,
    updateUrl = true
  ) {
    const normalized = normalizeHandle(newHandle);
    setRequestedHandle(normalized);
    setRoomHandle(normalized);
    setRoomHandleInput(newHandle);

    const roomOwner = await fetchRoomOwnerByHandle(normalized);
    if (!roomOwner) {
      throw new Error("Sala de live nao encontrada para esse @.");
    }

    setRoomOwnerAccount(roomOwner);
    if (updateUrl) {
      router.replace(`/live?stream=${encodeURIComponent(normalized)}`, { scroll: false });
    }
    await loadRoomMessages(roomOwner, currentViewer);
  }

  async function loadRoomMessages(currentRoomOwner: AccountRow, currentViewer: AccountRow) {
    const supabase = getSupabaseBrowserClient();
    const moderationAllowed = currentViewer.is_moderator;
    const cutoffIso = new Date(Date.now() - LIVE_RETENTION_HOURS * 60 * 60 * 1000).toISOString();

    const { data: rawMessages, error: messagesError } = await supabase
      .from("live_messages")
      .select(
        "id, room_owner_user_id, author_user_id, content, media_url, media_type, moderation_status, moderation_reason, moderated_by_user_id, moderated_at, created_at"
      )
      .eq("room_owner_user_id", currentRoomOwner.user_id)
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(LIVE_MAX_MESSAGES);

    if (messagesError) throw messagesError;
    const typedMessages = (rawMessages as LiveMessage[]) ?? [];
    setMessages(typedMessages);

    const authorIds = Array.from(new Set(typedMessages.map((message) => message.author_user_id)));
    if (authorIds.length > 0) {
      const { data: authorsRaw, error: authorsError } = await supabase
        .from("accounts")
        .select(
          "user_id, name, handle, youtube_account, profile_photo_url, theme_preference, notifications_enabled, email_verified_optional, email_verified_at, is_moderator"
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
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: true })
        .limit(LIVE_MAX_PENDING);
      if (pendingError) throw pendingError;
      setPendingMessages((rawPending as LiveMessage[]) ?? []);
    } else {
      setPendingMessages([]);
    }

    cleanupOldLiveMessages(currentRoomOwner.user_id);
  }

  async function cleanupOldLiveMessages(roomOwnerUserId: string) {
    const now = Date.now();
    if (now - lastCleanupRef.current < LIVE_CLEANUP_COOLDOWN_MS) return;
    lastCleanupRef.current = now;

    try {
      const response = await fetch("/api/live-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomOwnerUserId,
          retentionHours: LIVE_RETENTION_HOURS
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        console.warn("Falha ao limpar mensagens antigas:", payload?.error || response.statusText);
      }
    } catch (caughtError) {
      console.warn(
        "Falha ao limpar mensagens antigas:",
        caughtError instanceof Error ? caughtError.message : caughtError
      );
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
      const rawOverlayKey = searchParams?.get("key") || "";
      setRequestedHandle(normalizedStream);
      setOverlayMode(isOverlay);
      setOverlayAccessKey(rawOverlayKey);

      if (isOverlay) {
        if (!normalizedStream) {
          throw new Error("URL de overlay sem stream.");
        }
        if (!rawOverlayKey) {
          throw new Error("URL de overlay sem chave de acesso.");
        }
        await loadOverlayMessages(normalizedStream, rawOverlayKey);
        return;
      }

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

      const initialRoomHandle = normalizedStream || ensuredViewer.handle;
      setRoomHandle(initialRoomHandle);
      setRoomHandleInput(initialRoomHandle);

      await switchRoomHandle(initialRoomHandle, ensuredViewer, false);
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
    if (overlayMode) {
      return;
    }

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
  }, [router, overlayMode]);

  useEffect(() => {
    if (overlayMode) {
      if (!requestedHandle || !overlayAccessKey) return;
      let active = true;
      const interval = setInterval(() => {
        loadOverlayMessages(requestedHandle, overlayAccessKey).catch((caughtError) => {
          if (!active) return;
          const messageText =
            caughtError instanceof Error ? caughtError.message : "Falha ao atualizar overlay.";
          setError(messageText);
        });
      }, LIVE_POLL_MS);

      return () => {
        active = false;
        clearInterval(interval);
      };
    }

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
  }, [overlayMode, requestedHandle, overlayAccessKey, roomOwnerAccount, viewerAccount]);

  useEffect(() => {
    if (!overlayMode) return;
    const feed = overlayFeedRef.current;
    if (!feed) return;
    const raf = requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [overlayMode, messages]);

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

  async function handleSwitchRoom(event: FormEvent) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (!viewerAccount) {
      setError("Sessao invalida. Atualize a pagina.");
      return;
    }

    try {
      await switchRoomHandle(roomHandleInput, viewerAccount);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao mudar de sala.";
      setError(messageText);
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
        const moderatedContent =
          message.content && message.content.trim().length > 0
            ? message.content
            : "[Conteudo improprio removido pela moderacao.]";

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
            content: moderatedContent,
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
        <div className="tw-live-feed" ref={overlayFeedRef}>
          {visibleMessages.map((message) => {
            if (message.moderation_status !== "approved") return null;
            const author =
              message.author_handle || authorMap[message.author_user_id]?.handle || "anon";
            return (
              <article className="tw-live-message" key={message.id}>
                <header className="tw-live-message-head">
                  <strong className="tw-live-author">@{author}</strong>
                  <time className="tw-live-time">
                    {new Date(message.created_at).toLocaleTimeString("pt-BR")}
                  </time>
                </header>
                {message.content ? (
                  <p className="tw-live-content">{renderLiveContent(message.content)}</p>
                ) : null}
                {message.media_url && message.media_type === "video" ? (
                  <video
                    className="tw-live-media"
                    src={message.media_url}
                    autoPlay
                    muted
                    loop
                    playsInline
                  />
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
      <section className="tw-card tw-live-hero">
        <div className="tw-live-hero-head">
          <h1 className="tw-section-title">Live Chat</h1>
          <div className="tw-inline-actions">
            <button className="retro-button tw-small-button" type="button" onClick={() => router.push("/")}>
              Voltar ao feed
            </button>
            {roomOwnerAccount?.handle ? (
              <button
                className="retro-button tw-small-button"
                type="button"
                onClick={() => router.push(`/perfil/${roomOwnerAccount.handle}`)}
              >
                Ver perfil da live
              </button>
            ) : null}
          </div>
        </div>
        <p className="retro-muted">
          Sala atual: @{roomOwnerAccount?.handle || "sem-handle"}
          {requestedHandle ? " (acesso por stream)" : " (sua sala)"}
        </p>
        <div className="tw-live-steps">
          <div className="tw-live-step">
            <strong>1.</strong> Digite o @ da sala e clique em Acessar.
          </div>
          <div className="tw-live-step">
            <strong>2.</strong> Escreva sua mensagem e envie para o chat.
          </div>
        </div>
      </section>

      <div className="tw-live-layout">
        <section className="tw-card">
          <h2 className="tw-section-title">Sala e acesso</h2>
          <form className="retro-form" onSubmit={handleSwitchRoom}>
            <label className="retro-muted" htmlFor="room-handle">
              Entrar em outra sala
            </label>
            <div className="tw-inline-actions">
              <input
                id="room-handle"
                className="retro-input"
                value={roomHandleInput}
                onChange={(event) => setRoomHandleInput(event.target.value)}
                placeholder="Digite o handle da sala (ex: slendermangames)"
              />
              <button
                className="retro-button"
                type="submit"
                disabled={!roomHandleInput.trim() || roomHandleInput.trim() === roomHandle}
              >
                Acessar
              </button>
            </div>
          </form>

          <details className="tw-live-details">
            <summary>Configurar overlay OBS</summary>
            <p className="retro-muted">
              URL para OBS overlay:{" "}
              <code className="tw-live-code">{embedUrl || "carregando..."}</code>
            </p>
            <p className="retro-muted">
              Substitua <code>SUA_CHAVE_OVERLAY</code> pela chave privada <code>OBS_OVERLAY_KEY</code>.
            </p>
          </details>
        </section>

        <section className="tw-card">
          <h2 className="tw-section-title">Enviar mensagem da live</h2>
          <p className="retro-muted">Escreva a mensagem, anexe midia se quiser e envie.</p>
          <form className="retro-form" onSubmit={submitLiveMessage}>
          <textarea
            className="tw-composer-input"
            placeholder="Mensagem para o chat da live..."
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="tw-share-box">
            <label className="retro-muted" htmlFor="live-share-link">
              Compartilhar post (link ou ID)
            </label>
            <div className="tw-inline-actions">
              <input
                id="live-share-link"
                className="retro-input"
                value={shareInput}
                onChange={(event) => setShareInput(event.target.value)}
                placeholder="Ex: https://twittlier.vercel.app/post/..."
              />
              <button className="retro-button" type="button" onClick={appendPostLinkToMessage}>
                Adicionar link
              </button>
              <button
                className="retro-button tw-small-button"
                type="button"
                onClick={openPostFromShareInput}
                disabled={!shareInput.trim()}
              >
                Abrir
              </button>
            </div>
            <p className="retro-muted">
              O link vai junto da mensagem e abre em outra aba.
            </p>
          </div>
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
      </div>

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

                  {message.content ? (
                    <p className="tw-live-content">{renderLiveContent(message.content)}</p>
                  ) : null}
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
