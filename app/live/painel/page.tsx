"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AccountRow, ensureAccountExists, getSeedFromUser, normalizeHandle } from "@/lib/account-utils";
import { getSessionUserWithRetry } from "@/lib/session-utils";
import {
  STAGE_PANEL_POLL_MS,
  clampStageImageDurationSeconds,
  extractStoragePathFromPublicUrl,
  formatStageAssetType,
  inferStageAssetTypeFromMime,
  normalizeShortcutKey,
  normalizeStageCommand,
  type StageAssetRow,
  type StageAssetType,
  type StageEventRow
} from "@/lib/live-stage";
import styles from "./page.module.css";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatShortcutLabel(shortcutKey: string | null) {
  if (!shortcutKey) return "Sem atalho";
  if (shortcutKey === " ") return "Space";
  if (shortcutKey === "arrowup") return "ArrowUp";
  if (shortcutKey === "arrowdown") return "ArrowDown";
  if (shortcutKey === "arrowleft") return "ArrowLeft";
  if (shortcutKey === "arrowright") return "ArrowRight";
  return shortcutKey.length === 1 ? shortcutKey.toUpperCase() : shortcutKey;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON";
}

export default function LiveModPanelPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [origin, setOrigin] = useState("");
  const [viewerAccount, setViewerAccount] = useState<AccountRow | null>(null);
  const [roomOwnerAccount, setRoomOwnerAccount] = useState<AccountRow | null>(null);
  const [roomHandle, setRoomHandle] = useState("");
  const [roomHandleInput, setRoomHandleInput] = useState("");
  const [assets, setAssets] = useState<StageAssetRow[]>([]);
  const [events, setEvents] = useState<StageEventRow[]>([]);
  const [quickCommand, setQuickCommand] = useState("");
  const [assetName, setAssetName] = useState("");
  const [assetCommand, setAssetCommand] = useState("");
  const [shortcutKey, setShortcutKey] = useState("");
  const [imageDurationSeconds, setImageDurationSeconds] = useState("8");
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState("");
  const [filePreviewType, setFilePreviewType] = useState<StageAssetType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingAsset, setIsSavingAsset] = useState(false);
  const [isSwitchingRoom, setIsSwitchingRoom] = useState(false);
  const [busyAssetId, setBusyAssetId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isForbidden, setIsForbidden] = useState(false);

  const soundAssets = assets.filter((asset) => asset.media_type === "sound");
  const imageAssets = assets.filter((asset) => asset.media_type === "image");
  const videoAssets = assets.filter((asset) => asset.media_type === "video");

  useEffect(() => {
    document.documentElement.classList.add("tw-mod-panel-html");
    document.body.classList.add("tw-mod-panel-body");
    return () => {
      document.documentElement.classList.remove("tw-mod-panel-html");
      document.body.classList.remove("tw-mod-panel-body");
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setFilePreviewUrl("");
      setFilePreviewType(null);
      return;
    }

    const previewType = inferStageAssetTypeFromMime(file.type);
    setFilePreviewType(previewType);
    const url = URL.createObjectURL(file);
    setFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function fetchRoomOwnerByHandle(handle: string) {
    const supabase = getSupabaseBrowserClient();
    const normalized = normalizeHandle(handle);
    const { data, error: fetchError } = await supabase
      .from("accounts")
      .select(
        "user_id, name, handle, youtube_account, profile_photo_url, theme_preference, notifications_enabled, email_verified_optional, email_verified_at, is_moderator"
      )
      .eq("handle", normalized)
      .maybeSingle();

    if (fetchError) throw fetchError;
    return (data as AccountRow | null) ?? null;
  }

  async function loadStageAssets(roomOwnerUserId: string) {
    const supabase = getSupabaseBrowserClient();
    const { data, error: fetchError } = await supabase
      .from("live_overlay_assets")
      .select(
        "id, room_owner_user_id, created_by_user_id, name, command, media_url, media_type, shortcut_key, image_duration_seconds, created_at, updated_at"
      )
      .eq("room_owner_user_id", roomOwnerUserId)
      .order("created_at", { ascending: false });

    if (fetchError) throw fetchError;
    setAssets((data as StageAssetRow[]) ?? []);
  }

  async function loadRecentStageEvents(roomOwnerUserId: string) {
    const supabase = getSupabaseBrowserClient();
    const { data, error: fetchError } = await supabase
      .from("live_overlay_events")
      .select(
        "id, room_owner_user_id, asset_id, asset_name, asset_command, media_url, media_type, image_duration_seconds, triggered_by_user_id, triggered_by_handle, created_at"
      )
      .eq("room_owner_user_id", roomOwnerUserId)
      .order("created_at", { ascending: false })
      .limit(24);

    if (fetchError) throw fetchError;
    setEvents((data as StageEventRow[]) ?? []);
  }

  async function loadPanelData(roomOwnerUserId: string, silent = false) {
    if (!silent) {
      setIsRefreshing(true);
    }
    try {
      await Promise.all([loadStageAssets(roomOwnerUserId), loadRecentStageEvents(roomOwnerUserId)]);
    } finally {
      if (!silent) {
        setIsRefreshing(false);
      }
    }
  }

  async function switchRoom(newHandle: string, currentViewer: AccountRow, updateUrl = true) {
    const normalized = normalizeHandle(newHandle);
    setRoomHandle(normalized);
    setRoomHandleInput(normalized);

    const roomOwner = await fetchRoomOwnerByHandle(normalized);
    if (!roomOwner) {
      throw new Error("Sala da live nao encontrada para esse @.");
    }

    setRoomOwnerAccount(roomOwner);
    if (updateUrl) {
      router.replace(`/live/painel?stream=${encodeURIComponent(normalized)}`, { scroll: false });
    }

    await loadPanelData(roomOwner.user_id);
    if (currentViewer.handle === roomOwner.handle) {
      setStatus("Painel sincronizado com a sua propria live.");
      return;
    }
    setStatus(`Painel conectado na live @${roomOwner.handle}.`);
  }

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setIsLoading(true);
      setError("");
      setStatus("");
      setOrigin(window.location.origin);

      const supabase = getSupabaseBrowserClient();
      const { user: sessionUser, error: sessionError } = await getSessionUserWithRetry(supabase);
      if (!sessionUser) {
        if (sessionError) throw sessionError;
        router.replace("/auth");
        return;
      }

      const ensuredViewer = await ensureAccountExists(supabase, getSeedFromUser(sessionUser));
      if (!active) return;

      setViewerAccount(ensuredViewer);

      if (!ensuredViewer.is_moderator) {
        setIsForbidden(true);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const requestedStream = normalizeHandle(params.get("stream") || ensuredViewer.handle);
      await switchRoom(requestedStream, ensuredViewer, false);
    }

    bootstrap()
      .catch((caughtError) => {
        if (!active) return;
        const messageText =
          caughtError instanceof Error
            ? caughtError.message
            : "Falha ao carregar o painel de moderacao.";
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
    if (!viewerAccount?.is_moderator || !roomOwnerAccount) return;

    const interval = window.setInterval(() => {
      loadPanelData(roomOwnerAccount.user_id, true).catch((caughtError) => {
        const messageText =
          caughtError instanceof Error
            ? caughtError.message
            : "Falha ao atualizar painel da live.";
        setError(messageText);
      });
    }, STAGE_PANEL_POLL_MS);

    return () => window.clearInterval(interval);
  }, [viewerAccount, roomOwnerAccount]);

  useEffect(() => {
    if (!viewerAccount?.is_moderator || !roomOwnerAccount || assets.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const pressedKey = normalizeShortcutKey(event.key);
      if (!pressedKey) return;

      const asset = assets.find((candidate) => candidate.shortcut_key === pressedKey);
      if (!asset) return;

      event.preventDefault();
      void triggerAsset(asset);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [assets, roomOwnerAccount, viewerAccount]);

  function clearSelectedFile() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setFile(null);
    setFilePreviewType(null);
    setFilePreviewUrl("");
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;

    const detectedType = inferStageAssetTypeFromMime(selected.type);
    if (!detectedType) {
      setError("Formato invalido. Envie audio, imagem ou video.");
      return;
    }

    if (selected.size > 60 * 1024 * 1024) {
      setError("O asset precisa ter no maximo 60MB.");
      return;
    }

    setError("");
    setFile(selected);
  }

  async function uploadStageMedia(userId: string) {
    if (!file) {
      throw new Error("Escolha um audio, imagem ou video.");
    }

    const mediaType = inferStageAssetTypeFromMime(file.type);
    if (!mediaType) {
      throw new Error("Nao foi possivel identificar o tipo do asset.");
    }

    const supabase = getSupabaseBrowserClient();
    const extension = file.name.split(".").pop() || "bin";
    const filePath = `${userId}/overlay-assets/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("live-media")
      .upload(filePath, file, { upsert: false, contentType: file.type });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("live-media").getPublicUrl(filePath);
    return { mediaUrl: data.publicUrl, mediaType };
  }

  async function handleSwitchRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!viewerAccount) {
      setError("Sessao invalida. Atualize a pagina.");
      return;
    }

    setIsSwitchingRoom(true);
    try {
      await switchRoom(roomHandleInput, viewerAccount);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao trocar a sala.";
      setError(messageText);
    } finally {
      setIsSwitchingRoom(false);
    }
  }

  async function handleAddAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!viewerAccount || !roomOwnerAccount) {
      setError("Sessao invalida. Atualize a pagina.");
      return;
    }

    const name = assetName.trim().slice(0, 60);
    const command = normalizeStageCommand(assetCommand);
    const normalizedShortcut = normalizeShortcutKey(shortcutKey);

    if (!name) {
      setError("Diga como esse asset vai aparecer no painel.");
      return;
    }

    if (!command) {
      setError("Use um comando curto como !intervalo ou !som1.");
      return;
    }

    setIsSavingAsset(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { mediaUrl, mediaType } = await uploadStageMedia(viewerAccount.user_id);
      const durationForImage =
        mediaType === "image"
          ? clampStageImageDurationSeconds(Number(imageDurationSeconds))
          : null;

      const { error: insertError } = await supabase.from("live_overlay_assets").insert({
        room_owner_user_id: roomOwnerAccount.user_id,
        created_by_user_id: viewerAccount.user_id,
        name,
        command,
        media_url: mediaUrl,
        media_type: mediaType,
        shortcut_key: normalizedShortcut || null,
        image_duration_seconds: durationForImage
      });

      if (insertError) {
        if (insertError.code === "23505") {
          throw new Error("Ja existe um comando igual nessa live. Use outro nome de comando.");
        }
        throw insertError;
      }

      setAssetName("");
      setAssetCommand("");
      setShortcutKey("");
      setImageDurationSeconds("8");
      clearSelectedFile();
      setStatus(`Asset ${name} adicionado no painel da live.`);
      await loadPanelData(roomOwnerAccount.user_id);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao salvar asset.";
      setError(messageText);
    } finally {
      setIsSavingAsset(false);
    }
  }

  async function triggerAsset(asset: StageAssetRow) {
    if (!viewerAccount || !roomOwnerAccount) return;

    setBusyAssetId(asset.id);
    setError("");
    setStatus("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: insertError } = await supabase.from("live_overlay_events").insert({
        room_owner_user_id: roomOwnerAccount.user_id,
        asset_id: asset.id,
        asset_name: asset.name,
        asset_command: asset.command,
        media_url: asset.media_url,
        media_type: asset.media_type,
        image_duration_seconds: asset.image_duration_seconds,
        triggered_by_user_id: viewerAccount.user_id,
        triggered_by_handle: viewerAccount.handle
      });

      if (insertError) throw insertError;

      setStatus(`${asset.name} entrou na fila do overlay da live.`);
      await loadRecentStageEvents(roomOwnerAccount.user_id);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao disparar asset.";
      setError(messageText);
    } finally {
      setBusyAssetId("");
    }
  }

  async function handleQuickCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");

    const normalizedCommand = normalizeStageCommand(quickCommand);
    if (!normalizedCommand) {
      setError("Digite um comando valido para disparar.");
      return;
    }

    const asset = assets.find((candidate) => candidate.command === normalizedCommand);
    if (!asset) {
      setError("Nenhum asset encontrado para esse comando.");
      return;
    }

    await triggerAsset(asset);
    setQuickCommand("");
  }

  async function handleDeleteAsset(asset: StageAssetRow) {
    if (!roomOwnerAccount) return;

    setBusyAssetId(asset.id);
    setError("");
    setStatus("");

    try {
      const supabase = getSupabaseBrowserClient();
      const filePath = extractStoragePathFromPublicUrl(asset.media_url, "live-media");
      if (filePath) {
        const { error: removeError } = await supabase.storage.from("live-media").remove([filePath]);
        if (removeError && !removeError.message.toLowerCase().includes("not found")) {
          throw removeError;
        }
      }

      const { error: deleteError } = await supabase
        .from("live_overlay_assets")
        .delete()
        .eq("id", asset.id)
        .eq("room_owner_user_id", roomOwnerAccount.user_id);

      if (deleteError) throw deleteError;

      setStatus(`${asset.name} removido da soundboard da live.`);
      await loadPanelData(roomOwnerAccount.user_id);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao remover asset.";
      setError(messageText);
    } finally {
      setBusyAssetId("");
    }
  }

  async function copyObsUrl() {
    if (!origin || !roomOwnerAccount) return;
    const obsUrl = `${origin}/live/painel/overlay?stream=${roomOwnerAccount.handle}`;
    try {
      await navigator.clipboard.writeText(obsUrl);
      setStatus("URL do OBS copiada.");
    } catch {
      setStatus("Nao consegui copiar automatico, mas a URL ja esta visivel no painel.");
    }
  }

  if (isLoading) {
    return (
      <main className={styles.shell}>
        <section className={styles.heroCard}>
          <p className={styles.eyebrow}>Broadcast Desk</p>
          <h1 className={styles.title}>Carregando painel dos moderadores...</h1>
        </section>
      </main>
    );
  }

  if (isForbidden || !viewerAccount?.is_moderator) {
    return (
      <main className={styles.shell}>
        <section className={styles.heroCard}>
          <p className={styles.eyebrow}>Area restrita</p>
          <h1 className={styles.title}>Esse painel e exclusivo para moderadores.</h1>
          <p className={styles.lead}>
            A verificacao acontece pelo campo <code>accounts.is_moderator</code> no Supabase.
          </p>
          <button className={styles.primaryButton} type="button" onClick={() => router.push("/")}>
            Voltar ao feed
          </button>
        </section>
      </main>
    );
  }

  const obsUrl =
    origin && roomOwnerAccount
      ? `${origin}/live/painel/overlay?stream=${roomOwnerAccount.handle}`
      : "";

  return (
    <main className={styles.shell}>
      <section className={styles.heroCard}>
        <div className={styles.heroTop}>
          <div>
            <p className={styles.eyebrow}>Broadcast Desk</p>
            <h1 className={styles.title}>Painel de palco para moderadores</h1>
            <p className={styles.lead}>
              Clique, digite um comando ou use atalhos para soltar som, imagem e video no overlay
              da live.
            </p>
          </div>
          <div className={styles.heroMeta}>
            <span className={styles.metaChip}>MOD @{viewerAccount.handle}</span>
            <span className={styles.metaChip}>LIVE @{roomOwnerAccount?.handle || roomHandle}</span>
            <span className={styles.metaChip}>{assets.length} assets ativos</span>
          </div>
        </div>

        <div className={styles.heroGrid}>
          <form className={styles.inlineForm} onSubmit={handleSwitchRoom}>
            <label className={styles.fieldLabel} htmlFor="room-handle">
              Sala da live
            </label>
            <div className={styles.inlineFieldRow}>
              <input
                id="room-handle"
                className={styles.textInput}
                value={roomHandleInput}
                onChange={(event) => setRoomHandleInput(event.target.value)}
                placeholder="Digite o handle da live"
              />
              <button
                className={styles.secondaryButton}
                type="submit"
                disabled={!roomHandleInput.trim() || isSwitchingRoom}
              >
                {isSwitchingRoom ? "Conectando..." : "Conectar live"}
              </button>
            </div>
          </form>

          <form className={styles.inlineForm} onSubmit={handleQuickCommand}>
            <label className={styles.fieldLabel} htmlFor="quick-command">
              Console rapido
            </label>
            <div className={styles.inlineFieldRow}>
              <input
                id="quick-command"
                className={styles.textInput}
                value={quickCommand}
                onChange={(event) => setQuickCommand(event.target.value)}
                placeholder="Ex: !intervalo"
              />
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={!quickCommand.trim() || !!busyAssetId}
              >
                Disparar
              </button>
            </div>
          </form>
        </div>

        <div className={styles.obsBox}>
          <div>
            <p className={styles.fieldLabel}>URL do Browser Source no OBS</p>
            <code className={styles.codeBlock}>{obsUrl || "carregando..."}</code>
          </div>
          <div className={styles.obsActions}>
            <button className={styles.secondaryButton} type="button" onClick={copyObsUrl}>
              Copiar URL base
            </button>
            <button className={styles.ghostButton} type="button" onClick={() => router.push("/live")}>
              Voltar para Live
            </button>
          </div>
        </div>

        <div className={styles.noticeBar}>
          <span>Atalhos funcionam quando o painel esta em foco.</span>
          <span>Som gera aviso na tela. Video e imagem entram sem aviso textual.</span>
          {isRefreshing ? <span>Atualizando biblioteca...</span> : null}
        </div>

        {status ? <p className={styles.statusText}>{status}</p> : null}
        {error ? <p className={styles.errorText}>{error}</p> : null}
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <p className={styles.eyebrow}>Novo asset</p>
              <h2 className={styles.cardTitle}>Adicionar na biblioteca</h2>
            </div>
            <span className={styles.sideHint}>Audio, imagem e video</span>
          </div>

          <form className={styles.assetForm} onSubmit={handleAddAsset}>
            <div className={styles.formColumns}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Nome visivel</span>
                <input
                  className={styles.textInput}
                  value={assetName}
                  onChange={(event) => setAssetName(event.target.value)}
                  placeholder="Ex: Vinheta de intervalo"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Comando</span>
                <input
                  className={styles.textInput}
                  value={assetCommand}
                  onChange={(event) => setAssetCommand(event.target.value)}
                  placeholder="Ex: !intervalo"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Atalho rapido</span>
                <input
                  className={styles.textInput}
                  value={shortcutKey}
                  onChange={(event) => setShortcutKey(event.target.value)}
                  placeholder="Ex: q, 1, f1"
                />
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Tempo da imagem</span>
                <input
                  className={styles.textInput}
                  type="number"
                  min={2}
                  max={120}
                  value={imageDurationSeconds}
                  onChange={(event) => setImageDurationSeconds(event.target.value)}
                />
              </label>
            </div>

            <label className={styles.uploadField}>
              <input
                ref={fileInputRef}
                className={styles.hiddenInput}
                type="file"
                accept="audio/*,image/*,video/*"
                onChange={onFileChange}
              />
              <span className={styles.uploadTitle}>
                {file ? "Asset pronto para subir" : "Selecionar audio, imagem ou video"}
              </span>
              <span className={styles.uploadMeta}>
                {file ? `${file.name} (${formatBytes(file.size)})` : "Clique aqui para escolher"}
              </span>
            </label>

            {filePreviewUrl ? (
              <div className={styles.previewBox}>
                <p className={styles.previewTitle}>
                  Preview {filePreviewType ? `| ${formatStageAssetType(filePreviewType)}` : ""}
                </p>
                {filePreviewType === "sound" ? (
                  <audio className={styles.previewMedia} src={filePreviewUrl} controls />
                ) : null}
                {filePreviewType === "image" ? (
                  <img className={styles.previewMedia} src={filePreviewUrl} alt="Preview do asset" />
                ) : null}
                {filePreviewType === "video" ? (
                  <video className={styles.previewMedia} src={filePreviewUrl} controls />
                ) : null}
              </div>
            ) : null}

            <div className={styles.formFooter}>
              <button className={styles.ghostButton} type="button" onClick={clearSelectedFile}>
                Limpar
              </button>
              <button className={styles.primaryButton} type="submit" disabled={isSavingAsset}>
                {isSavingAsset ? "Salvando..." : "Adicionar asset"}
              </button>
            </div>
          </form>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <p className={styles.eyebrow}>Atividade</p>
              <h2 className={styles.cardTitle}>Ultimos disparos</h2>
            </div>
            <span className={styles.sideHint}>Log dos moderadores</span>
          </div>

          <div className={styles.activityList}>
            {events.length === 0 ? (
              <div className={styles.emptyState}>
                Nada disparado ainda. Quando um mod usar um comando, ele aparece aqui.
              </div>
            ) : (
              events.map((eventItem) => (
                <article className={styles.activityItem} key={eventItem.id}>
                  <div className={styles.activityTop}>
                    <strong>{eventItem.asset_name}</strong>
                    <span className={styles.assetBadge}>{formatStageAssetType(eventItem.media_type)}</span>
                  </div>
                  <p className={styles.activityMeta}>
                    @{eventItem.triggered_by_handle} usou {eventItem.asset_command}
                  </p>
                  <p className={styles.activityMeta}>
                    {new Date(eventItem.created_at).toLocaleString("pt-BR")}
                  </p>
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section className={styles.librarySection}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>Biblioteca ao vivo</p>
            <h2 className={styles.cardTitle}>Assets prontos para palco</h2>
          </div>
          <span className={styles.sideHint}>Clique ou use os atalhos cadastrados</span>
        </div>

        <div className={styles.libraryColumns}>
          <div className={styles.libraryColumn}>
            <div className={styles.libraryColumnHead}>
              <h3 className={styles.libraryTitle}>Soundboard</h3>
              <span className={styles.counterChip}>{soundAssets.length}</span>
            </div>
            {soundAssets.length === 0 ? (
              <div className={styles.emptyState}>Nenhum som cadastrado ainda.</div>
            ) : (
              <div className={styles.assetList}>
                {soundAssets.map((asset) => (
                  <article className={styles.assetCard} key={asset.id}>
                    <div className={styles.assetCardTop}>
                      <div>
                        <h4 className={styles.assetName}>{asset.name}</h4>
                        <p className={styles.assetMeta}>
                          {asset.command} | {formatShortcutLabel(asset.shortcut_key)}
                        </p>
                      </div>
                      <span className={styles.assetBadge}>Som</span>
                    </div>
                    <audio className={styles.compactPreview} src={asset.media_url} controls preload="none" />
                    <div className={styles.assetActions}>
                      <button
                        className={styles.primaryButton}
                        type="button"
                        disabled={busyAssetId === asset.id}
                        onClick={() => void triggerAsset(asset)}
                      >
                        {busyAssetId === asset.id ? "Enviando..." : "Tocar na live"}
                      </button>
                      <button
                        className={styles.ghostButton}
                        type="button"
                        disabled={busyAssetId === asset.id}
                        onClick={() => void handleDeleteAsset(asset)}
                      >
                        Remover
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className={styles.libraryColumn}>
            <div className={styles.libraryColumnHead}>
              <h3 className={styles.libraryTitle}>Imagens</h3>
              <span className={styles.counterChip}>{imageAssets.length}</span>
            </div>
            {imageAssets.length === 0 ? (
              <div className={styles.emptyState}>Nenhuma imagem pronta para o overlay.</div>
            ) : (
              <div className={styles.assetList}>
                {imageAssets.map((asset) => (
                  <article className={styles.assetCard} key={asset.id}>
                    <div className={styles.assetCardTop}>
                      <div>
                        <h4 className={styles.assetName}>{asset.name}</h4>
                        <p className={styles.assetMeta}>
                          {asset.command} | {formatShortcutLabel(asset.shortcut_key)}
                        </p>
                        <p className={styles.assetMeta}>
                          Fica no ar por {asset.image_duration_seconds || 8}s
                        </p>
                      </div>
                      <span className={styles.assetBadge}>Imagem</span>
                    </div>
                    <img className={styles.cardMedia} src={asset.media_url} alt={asset.name} />
                    <div className={styles.assetActions}>
                      <button
                        className={styles.primaryButton}
                        type="button"
                        disabled={busyAssetId === asset.id}
                        onClick={() => void triggerAsset(asset)}
                      >
                        {busyAssetId === asset.id ? "Enviando..." : "Mostrar na live"}
                      </button>
                      <button
                        className={styles.ghostButton}
                        type="button"
                        disabled={busyAssetId === asset.id}
                        onClick={() => void handleDeleteAsset(asset)}
                      >
                        Remover
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className={styles.libraryColumn}>
            <div className={styles.libraryColumnHead}>
              <h3 className={styles.libraryTitle}>Videos</h3>
              <span className={styles.counterChip}>{videoAssets.length}</span>
            </div>
            {videoAssets.length === 0 ? (
              <div className={styles.emptyState}>Nenhum video cadastrado ainda.</div>
            ) : (
              <div className={styles.assetList}>
                {videoAssets.map((asset) => (
                  <article className={styles.assetCard} key={asset.id}>
                    <div className={styles.assetCardTop}>
                      <div>
                        <h4 className={styles.assetName}>{asset.name}</h4>
                        <p className={styles.assetMeta}>
                          {asset.command} | {formatShortcutLabel(asset.shortcut_key)}
                        </p>
                      </div>
                      <span className={styles.assetBadge}>Video</span>
                    </div>
                    <video className={styles.cardMedia} src={asset.media_url} controls preload="metadata" />
                    <div className={styles.assetActions}>
                      <button
                        className={styles.primaryButton}
                        type="button"
                        disabled={busyAssetId === asset.id}
                        onClick={() => void triggerAsset(asset)}
                      >
                        {busyAssetId === asset.id ? "Enviando..." : "Soltar no overlay"}
                      </button>
                      <button
                        className={styles.ghostButton}
                        type="button"
                        disabled={busyAssetId === asset.id}
                        onClick={() => void handleDeleteAsset(asset)}
                      >
                        Remover
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
