"use client";

import { CSSProperties, ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AccountRow, ensureAccountExists, getSeedFromUser, normalizeHandle } from "@/lib/account-utils";
import { getSessionUserWithRetry } from "@/lib/session-utils";
import {
  STAGE_PANEL_POLL_MS,
  DEFAULT_STAGE_AUDIO_VOLUME_PERCENT,
  DEFAULT_STAGE_DISPLAY_SIZE_PERCENT,
  DEFAULT_STAGE_DISPLAY_X_PERCENT,
  DEFAULT_STAGE_DISPLAY_Y_PERCENT,
  clampStageImageDurationSeconds,
  clampStageAudioVolumePercent,
  clampStageDisplayCoordinatePercent,
  clampStageDisplaySizePercent,
  extractStoragePathFromPublicUrl,
  formatStageAssetType,
  formatStageDisplayFit,
  formatStageEntryAnimation,
  inferStageAssetTypeFromMime,
  normalizeStageDisplayFit,
  normalizeStageEntryAnimation,
  normalizeShortcutKey,
  normalizeStageCommand,
  STAGE_DISPLAY_FIT_OPTIONS,
  STAGE_ENTRY_ANIMATION_OPTIONS,
  addElementToOverlayState,
  updateOverlayElement,
  removeOverlayElement,
  clearOverlayState,
  getOverlayStateByStream,
  type StageDisplayFit,
  type StageEntryAnimation,
  type StageAssetRow,
  type StageAssetType,
  type StageEventRow,
  type OverlayActiveElement
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

type StageAssetStyleDraft = {
  imageDurationSeconds: string;
  displaySizePercent: string;
  displayXPercent: string;
  displayYPercent: string;
  displayFit: StageDisplayFit;
  entryAnimation: StageEntryAnimation;
  audioVolumePercent: string;
};

type StageAssetStyleField = keyof StageAssetStyleDraft;

function createDefaultStageAssetStyleDraft(): StageAssetStyleDraft {
  return {
    imageDurationSeconds: "8",
    displaySizePercent: String(DEFAULT_STAGE_DISPLAY_SIZE_PERCENT),
    displayXPercent: String(DEFAULT_STAGE_DISPLAY_X_PERCENT),
    displayYPercent: String(DEFAULT_STAGE_DISPLAY_Y_PERCENT),
    displayFit: "contain",
    entryAnimation: "fade",
    audioVolumePercent: String(DEFAULT_STAGE_AUDIO_VOLUME_PERCENT)
  };
}

function createStageAssetStyleDraftFromAsset(asset: StageAssetRow): StageAssetStyleDraft {
  return {
    imageDurationSeconds: String(asset.image_duration_seconds ?? 8),
    displaySizePercent: String(asset.display_size_percent),
    displayXPercent: String(asset.display_x_percent),
    displayYPercent: String(asset.display_y_percent),
    displayFit: asset.display_fit,
    entryAnimation: asset.entry_animation,
    audioVolumePercent: String(asset.audio_volume_percent)
  };
}

function summarizeStageAssetVisual(asset: StageAssetRow) {
  const animationLabel = formatStageEntryAnimation(asset.entry_animation);
  if (asset.media_type === "sound") {
    return `Volume ${asset.audio_volume_percent}% | ${animationLabel}`;
  }

  const fitLabel = formatStageDisplayFit(asset.display_fit);
  const sizeLabel = `${asset.display_size_percent}%`;
  const coordinateLabel = `X ${asset.display_x_percent}% | Y ${asset.display_y_percent}%`;
  const durationLabel =
    asset.media_type === "image" ? ` | ${asset.image_duration_seconds || 8}s` : "";
  return `${sizeLabel} | ${coordinateLabel} | ${fitLabel} | ${animationLabel}${durationLabel}`;
}

function summarizeActiveElementVisual(element: OverlayActiveElement) {
  if (element.media_type === "sound") {
    return `Audio ${element.audio_volume_percent}%`;
  }

  return `Tamanho ${element.display_size_percent}% | X ${element.display_x_percent}% | Y ${element.display_y_percent}% | Z ${element.z_index}`;
}

type StageAssetConfiguratorProps = {
  assetName: string;
  draft: StageAssetStyleDraft;
  helperText?: string;
  mediaType: StageAssetType | null;
  previewUrl: string;
  title: string;
  onFieldChange: (field: StageAssetStyleField, value: string) => void;
};

function StageAssetConfigurator({
  assetName,
  draft,
  helperText,
  mediaType,
  previewUrl,
  title,
  onFieldChange
}: StageAssetConfiguratorProps) {
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const [replayNonce, setReplayNonce] = useState(0);
  const [isDraggingPreview, setIsDraggingPreview] = useState(false);

  const displaySizePercent = clampStageDisplaySizePercent(Number(draft.displaySizePercent));
  const imageDurationSeconds = clampStageImageDurationSeconds(Number(draft.imageDurationSeconds));
  const audioVolumePercent = clampStageAudioVolumePercent(Number(draft.audioVolumePercent));
  const displayXPercent = clampStageDisplayCoordinatePercent(Number(draft.displayXPercent));
  const displayYPercent = clampStageDisplayCoordinatePercent(Number(draft.displayYPercent));
  const displayFit = normalizeStageDisplayFit(draft.displayFit);
  const entryAnimation = normalizeStageEntryAnimation(draft.entryAnimation);

  useEffect(() => {
    setReplayNonce((current) => current + 1);
  }, [
    assetName,
    draft.audioVolumePercent,
    draft.displayFit,
    draft.displaySizePercent,
    draft.displayXPercent,
    draft.displayYPercent,
    draft.entryAnimation,
    draft.imageDurationSeconds,
    mediaType,
    previewUrl
  ]);

  useEffect(() => {
    if (!audioPreviewRef.current) return;
    audioPreviewRef.current.volume = audioVolumePercent / 100;
  }, [audioVolumePercent, previewUrl]);

  function updateDragPosition(clientX: number, clientY: number) {
    const stage = previewStageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    onFieldChange("displayXPercent", String(clampStageDisplayCoordinatePercent(x)));
    onFieldChange("displayYPercent", String(clampStageDisplayCoordinatePercent(y)));
  }

  function handlePreviewPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (mediaType !== "image" && mediaType !== "video") return;
    if (!previewUrl) return;
    event.preventDefault();
    updateDragPosition(event.clientX, event.clientY);
    setIsDraggingPreview(true);
  }

  useEffect(() => {
    if (!isDraggingPreview) return;

    const onPointerMove = (event: PointerEvent) => {
      updateDragPosition(event.clientX, event.clientY);
    };
    const stopDragging = () => {
      setIsDraggingPreview(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [isDraggingPreview]);

  const previewKey = [
    replayNonce,
    assetName,
    mediaType || "none",
    previewUrl,
    displaySizePercent,
    displayXPercent,
    displayYPercent,
    displayFit,
    entryAnimation,
    imageDurationSeconds,
    audioVolumePercent
  ].join(":");

  return (
    <div className={styles.visualEditor}>
      <div className={styles.visualEditorHead}>
        <div>
          <p className={styles.previewTitle}>{title}</p>
          {helperText ? <p className={styles.previewHint}>{helperText}</p> : null}
        </div>
        <button
          className={styles.ghostButton}
          type="button"
          onClick={() => setReplayNonce((current) => current + 1)}
          disabled={!previewUrl}
        >
          Repetir animacao
        </button>
      </div>

      <div className={styles.visualEditorGrid}>
        <div className={styles.visualControls}>
          {(mediaType === "image" || mediaType === "video" || mediaType === null) ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Tamanho na tela</span>
                <div className={styles.rangeRow}>
                  <input
                    className={styles.rangeInput}
                    type="range"
                    min={5}
                    max={150}
                    value={displaySizePercent}
                    onChange={(event) => onFieldChange("displaySizePercent", event.target.value)}
                  />
                  <strong className={styles.rangeValue}>{displaySizePercent}%</strong>
                </div>
                <p className={styles.fieldHint}>
                  Controla o tamanho da caixa do asset na tela. Pode passar de 100%.
                </p>
              </label>

              <div className={styles.coordinatePanel}>
                <div className={styles.coordinateHead}>
                  <span className={styles.fieldLabel}>Posicao livre</span>
                  <button
                    className={styles.ghostButton}
                    type="button"
                    onClick={() => {
                      onFieldChange("displayXPercent", String(DEFAULT_STAGE_DISPLAY_X_PERCENT));
                      onFieldChange("displayYPercent", String(DEFAULT_STAGE_DISPLAY_Y_PERCENT));
                    }}
                  >
                    Centralizar
                  </button>
                </div>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Horizontal</span>
                  <div className={styles.rangeRow}>
                    <input
                      className={styles.rangeInput}
                      type="range"
                      min={0}
                      max={100}
                      value={displayXPercent}
                      onChange={(event) => onFieldChange("displayXPercent", event.target.value)}
                    />
                    <strong className={styles.rangeValue}>{displayXPercent}%</strong>
                  </div>
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Vertical</span>
                  <div className={styles.rangeRow}>
                    <input
                      className={styles.rangeInput}
                      type="range"
                      min={0}
                      max={100}
                      value={displayYPercent}
                      onChange={(event) => onFieldChange("displayYPercent", event.target.value)}
                    />
                    <strong className={styles.rangeValue}>{displayYPercent}%</strong>
                  </div>
                  <p className={styles.fieldHint}>Voce tambem pode arrastar direto no preview.</p>
                </label>
              </div>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Encaixe</span>
                <select
                  className={styles.selectInput}
                  value={displayFit}
                  onChange={(event) => onFieldChange("displayFit", event.target.value)}
                >
                  {STAGE_DISPLAY_FIT_OPTIONS.map((fit) => (
                    <option key={fit} value={fit}>
                      {formatStageDisplayFit(fit)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Animacao de entrada</span>
            <select
              className={styles.selectInput}
              value={entryAnimation}
              onChange={(event) => onFieldChange("entryAnimation", event.target.value)}
            >
              {STAGE_ENTRY_ANIMATION_OPTIONS.map((animation) => (
                <option key={animation} value={animation}>
                  {formatStageEntryAnimation(animation)}
                </option>
              ))}
            </select>
          </label>

          {(mediaType === "image" || mediaType === null) ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Tempo da imagem</span>
              <input
                className={styles.textInput}
                type="number"
                min={2}
                max={120}
                value={draft.imageDurationSeconds}
                onChange={(event) => onFieldChange("imageDurationSeconds", event.target.value)}
              />
              <p className={styles.fieldHint}>Usado quando o asset for imagem.</p>
            </label>
          ) : null}

          {(mediaType === "sound" || mediaType === null) ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Volume do audio</span>
              <div className={styles.rangeRow}>
                <input
                  className={styles.rangeInput}
                  type="range"
                  min={0}
                  max={100}
                  value={audioVolumePercent}
                  onChange={(event) => onFieldChange("audioVolumePercent", event.target.value)}
                />
                <strong className={styles.rangeValue}>{audioVolumePercent}%</strong>
              </div>
              <p className={styles.fieldHint}>Define o volume usado no overlay da live.</p>
            </label>
          ) : null}
        </div>

        <div className={styles.previewPanel}>
          <div className={styles.previewSurface}>
            <div className={styles.previewSurfaceHead}>
              <span className={styles.previewSurfaceBadge}>Preview da live 16:9</span>
              <span className={styles.previewSurfaceBadge}>
                {mediaType ? formatStageAssetType(mediaType) : "Sem arquivo"}
              </span>
            </div>

            <div
              ref={previewStageRef}
              className={styles.previewStage}
              onPointerDown={handlePreviewPointerDown}
              data-draggable={mediaType === "image" || mediaType === "video" ? "true" : "false"}
            >
              {previewUrl ? (
                mediaType === "sound" ? (
                  <div
                    key={previewKey}
                    className={styles.previewNotice}
                    data-animation={entryAnimation}
                  >
                    @{assetName || "mod"} usou um comando de som:{" "}
                    <strong>{assetName || "Novo som"}</strong>
                  </div>
                ) : (
                  <div className={styles.previewMediaLayer}>
                    <div
                      key={previewKey}
                      className={styles.previewMediaFrame}
                      data-animation={entryAnimation}
                      style={
                        {
                          left: `${displayXPercent}%`,
                          top: `${displayYPercent}%`,
                          width: `${displaySizePercent}%`,
                          height: `${displaySizePercent}%`
                        } satisfies CSSProperties
                      }
                    >
                      {mediaType === "image" ? (
                        <img
                          className={styles.previewStageMedia}
                          data-fit={displayFit}
                          src={previewUrl}
                          alt={assetName || "Preview"}
                        />
                      ) : null}
                      {mediaType === "video" ? (
                        <video
                          className={styles.previewStageMedia}
                          data-fit={displayFit}
                          src={previewUrl}
                          autoPlay
                          loop
                          muted
                          playsInline
                        />
                      ) : null}
                    </div>
                  </div>
                )
              ) : (
                <div className={styles.previewEmpty}>
                  Escolha um arquivo para liberar o preview visual do asset.
                </div>
              )}
            </div>
          </div>

          {mediaType === "sound" && previewUrl ? (
            <div className={styles.audioPreviewBox}>
              <p className={styles.fieldLabel}>Player do preview</p>
              <audio
                ref={audioPreviewRef}
                className={styles.compactPreview}
                src={previewUrl}
                controls
                preload="metadata"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
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
  const [activeElements, setActiveElements] = useState<OverlayActiveElement[]>([]);
  const [overlayVersion, setOverlayVersion] = useState(0);
  const [quickCommand, setQuickCommand] = useState("");
  const [assetName, setAssetName] = useState("");
  const [assetCommand, setAssetCommand] = useState("");
  const [shortcutKey, setShortcutKey] = useState("");
  const [createStyleDraft, setCreateStyleDraft] = useState<StageAssetStyleDraft>(
    createDefaultStageAssetStyleDraft()
  );
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState("");
  const [filePreviewType, setFilePreviewType] = useState<StageAssetType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingAsset, setIsSavingAsset] = useState(false);
  const [isSwitchingRoom, setIsSwitchingRoom] = useState(false);
  const [busyAssetId, setBusyAssetId] = useState("");
  const [busyActiveElementId, setBusyActiveElementId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isForbidden, setIsForbidden] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState("");
  const [editStyleDraft, setEditStyleDraft] = useState<StageAssetStyleDraft | null>(null);

  const soundAssets = assets.filter((asset) => asset.media_type === "sound");
  const imageAssets = assets.filter((asset) => asset.media_type === "image");
  const videoAssets = assets.filter((asset) => asset.media_type === "video");
  const editingAsset =
    editingAssetId && editStyleDraft
      ? assets.find((asset) => asset.id === editingAssetId) || null
      : null;

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

  useEffect(() => {
    if (!editingAssetId) return;
    if (assets.some((asset) => asset.id === editingAssetId)) return;
    setEditingAssetId("");
    setEditStyleDraft(null);
  }, [assets, editingAssetId]);

  function updateCreateStyleDraft(field: StageAssetStyleField, value: string) {
    setCreateStyleDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateEditStyleDraft(field: StageAssetStyleField, value: string) {
    setEditStyleDraft((current) => (current ? { ...current, [field]: value } : current));
  }

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
        "id, room_owner_user_id, created_by_user_id, name, command, media_url, media_type, shortcut_key, image_duration_seconds, display_size_percent, display_x_percent, display_y_percent, display_position, display_fit, entry_animation, audio_volume_percent, created_at, updated_at"
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
        "id, room_owner_user_id, asset_id, asset_name, asset_command, media_url, media_type, image_duration_seconds, display_size_percent, display_x_percent, display_y_percent, display_position, display_fit, entry_animation, audio_volume_percent, triggered_by_user_id, triggered_by_handle, created_at"
      )
      .eq("room_owner_user_id", roomOwnerUserId)
      .order("created_at", { ascending: false })
      .limit(24);

    if (fetchError) throw fetchError;
    setEvents((data as StageEventRow[]) ?? []);
  }

  async function loadActiveOverlayElements(streamHandle: string) {
    const payload = await getOverlayStateByStream(streamHandle);
    setActiveElements(payload.elements ?? []);
    setOverlayVersion(payload.version ?? 0);
  }

  async function loadPanelData(roomOwnerUserId: string, streamHandle: string, silent = false) {
    if (!silent) {
      setIsRefreshing(true);
    }
    try {
      await Promise.all([
        loadStageAssets(roomOwnerUserId),
        loadRecentStageEvents(roomOwnerUserId),
        streamHandle ? loadActiveOverlayElements(streamHandle) : Promise.resolve()
      ]);
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

    await loadPanelData(roomOwner.user_id, roomOwner.handle);
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
      loadPanelData(roomOwnerAccount.user_id, roomOwnerAccount.handle, true).catch((caughtError) => {
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

  function resolveStyleDraftForAsset(
    draft: StageAssetStyleDraft,
    mediaType: StageAssetType
  ) {
    return {
      image_duration_seconds:
        mediaType === "image"
          ? clampStageImageDurationSeconds(Number(draft.imageDurationSeconds))
          : null,
      display_size_percent: clampStageDisplaySizePercent(Number(draft.displaySizePercent)),
      display_x_percent: clampStageDisplayCoordinatePercent(Number(draft.displayXPercent)),
      display_y_percent: clampStageDisplayCoordinatePercent(Number(draft.displayYPercent)),
      display_position: "free" as const,
      display_fit:
        mediaType === "sound" ? "contain" : normalizeStageDisplayFit(draft.displayFit),
      entry_animation: normalizeStageEntryAnimation(draft.entryAnimation),
      audio_volume_percent:
        mediaType === "sound"
          ? clampStageAudioVolumePercent(Number(draft.audioVolumePercent))
          : DEFAULT_STAGE_AUDIO_VOLUME_PERCENT
    };
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
      const styleValues = resolveStyleDraftForAsset(createStyleDraft, mediaType);

      const { error: insertError } = await supabase.from("live_overlay_assets").insert({
        room_owner_user_id: roomOwnerAccount.user_id,
        created_by_user_id: viewerAccount.user_id,
        name,
        command,
        media_url: mediaUrl,
        media_type: mediaType,
        shortcut_key: normalizedShortcut || null,
        image_duration_seconds: styleValues.image_duration_seconds,
        display_size_percent: styleValues.display_size_percent,
        display_x_percent: styleValues.display_x_percent,
        display_y_percent: styleValues.display_y_percent,
        display_position: styleValues.display_position,
        display_fit: styleValues.display_fit,
        entry_animation: styleValues.entry_animation,
        audio_volume_percent: styleValues.audio_volume_percent
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
      setCreateStyleDraft(createDefaultStageAssetStyleDraft());
      clearSelectedFile();
      setStatus(`Asset ${name} adicionado no painel da live.`);
      await loadPanelData(roomOwnerAccount.user_id, roomOwnerAccount.handle);
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
      // Add element to overlay state (stateful system)
      await addElementToOverlayState(roomOwnerAccount.user_id, asset);
      setStatus(`${asset.name} adicionado ao overlay em tempo real.`);
      await loadRecentStageEvents(roomOwnerAccount.user_id);
      await loadActiveOverlayElements(roomOwnerAccount.handle);
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

  async function handleRemoveActiveElement(element: OverlayActiveElement) {
    if (!roomOwnerAccount) return;

    setBusyActiveElementId(element.id);
    setError("");
    setStatus("");
    try {
      await removeOverlayElement(element.id, roomOwnerAccount.user_id);
      setStatus(`${element.asset_name} removido do palco ao vivo.`);
      await loadActiveOverlayElements(roomOwnerAccount.handle);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao remover elemento ativo.";
      setError(messageText);
    } finally {
      setBusyActiveElementId("");
    }
  }

  async function handleClearOverlayNow() {
    if (!roomOwnerAccount) return;
    setBusyActiveElementId("clear-all");
    setError("");
    setStatus("");
    try {
      await clearOverlayState(roomOwnerAccount.user_id);
      setStatus("Palco limpo imediatamente.");
      await loadActiveOverlayElements(roomOwnerAccount.handle);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao limpar palco ao vivo.";
      setError(messageText);
    } finally {
      setBusyActiveElementId("");
    }
  }

  async function handleActiveElementFieldUpdate(
    element: OverlayActiveElement,
    field: "displayXPercent" | "displayYPercent" | "displaySizePercent" | "audioVolumePercent",
    value: string
  ) {
    if (!roomOwnerAccount) return;
    setBusyActiveElementId(element.id);
    setError("");

    try {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error("Valor numerico invalido para atualizacao ao vivo.");
      }

      const updatePayload =
        field === "displayXPercent"
          ? { displayXPercent: clampStageDisplayCoordinatePercent(parsed) }
          : field === "displayYPercent"
            ? { displayYPercent: clampStageDisplayCoordinatePercent(parsed) }
            : field === "displaySizePercent"
              ? { displaySizePercent: clampStageDisplaySizePercent(parsed) }
              : { audioVolumePercent: clampStageAudioVolumePercent(parsed) };

      await updateOverlayElement(element.id, roomOwnerAccount.user_id, updatePayload);
      await loadActiveOverlayElements(roomOwnerAccount.handle);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao atualizar elemento ativo.";
      setError(messageText);
    } finally {
      setBusyActiveElementId("");
    }
  }

  function startEditingAsset(asset: StageAssetRow) {
    setEditingAssetId(asset.id);
    setEditStyleDraft(createStageAssetStyleDraftFromAsset(asset));
    setStatus(`Editor aberto para ${asset.name}.`);
    setError("");
  }

  function cancelEditingAsset() {
    setEditingAssetId("");
    setEditStyleDraft(null);
    setStatus("Edicao visual cancelada.");
  }

  async function handleSaveAssetEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!roomOwnerAccount || !editingAsset || !editStyleDraft) {
      setError("Selecione um asset valido para editar.");
      return;
    }

    setBusyAssetId(editingAsset.id);
    try {
      const supabase = getSupabaseBrowserClient();
      const styleValues = resolveStyleDraftForAsset(editStyleDraft, editingAsset.media_type);
      const { error: updateError } = await supabase
        .from("live_overlay_assets")
        .update({
          image_duration_seconds: styleValues.image_duration_seconds,
          display_size_percent: styleValues.display_size_percent,
          display_x_percent: styleValues.display_x_percent,
          display_y_percent: styleValues.display_y_percent,
          display_position: styleValues.display_position,
          display_fit: styleValues.display_fit,
          entry_animation: styleValues.entry_animation,
          audio_volume_percent: styleValues.audio_volume_percent
        })
        .eq("id", editingAsset.id)
        .eq("room_owner_user_id", roomOwnerAccount.user_id);

      if (updateError) throw updateError;

      setStatus(`Visual de ${editingAsset.name} atualizado.`);
      setEditingAssetId("");
      setEditStyleDraft(null);
      await loadPanelData(roomOwnerAccount.user_id, roomOwnerAccount.handle);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao salvar a edicao.";
      setError(messageText);
    } finally {
      setBusyAssetId("");
    }
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
      await loadPanelData(roomOwnerAccount.user_id, roomOwnerAccount.handle);
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
          <span>Agora o palco e stateful: da para remover/editar elemento ativo em tempo real.</span>
          <span>Upload sem limite artificial de tamanho no frontend.</span>
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

            <StageAssetConfigurator
              title="Preview e estilo do novo asset"
              helperText="Ajuste como o asset vai entrar na live antes de salvar."
              mediaType={filePreviewType}
              previewUrl={filePreviewUrl}
              assetName={assetName || "Novo asset"}
              draft={createStyleDraft}
              onFieldChange={updateCreateStyleDraft}
            />

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

      <section className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <p className={styles.eyebrow}>Cena ao vivo</p>
            <h2 className={styles.cardTitle}>Elementos ativos em tempo real</h2>
          </div>
          <span className={styles.sideHint}>
            Versao {overlayVersion} | {activeElements.length} ativos
          </span>
        </div>

        <div className={styles.liveControlsBar}>
          <p className={styles.fieldHint}>
            Aqui voce consegue parar, remover e ajustar os elementos que ja estao no palco sem
            esperar o tempo acabar.
          </p>
          <button
            className={styles.ghostButton}
            type="button"
            disabled={activeElements.length === 0 || busyActiveElementId === "clear-all"}
            onClick={() => void handleClearOverlayNow()}
          >
            {busyActiveElementId === "clear-all" ? "Limpando..." : "Limpar palco agora"}
          </button>
        </div>

        {activeElements.length === 0 ? (
          <div className={styles.emptyState}>Nenhum elemento ativo no palco neste momento.</div>
        ) : (
          <div className={styles.liveElementList}>
            {activeElements.map((element) => (
              <article className={styles.liveElementCard} key={element.id}>
                <div className={styles.assetCardTop}>
                  <div>
                    <h4 className={styles.assetName}>{element.asset_name}</h4>
                    <p className={styles.assetMeta}>
                      {element.asset_command} | por @{element.added_by_handle}
                    </p>
                    <p className={styles.assetMeta}>{summarizeActiveElementVisual(element)}</p>
                  </div>
                  <span className={styles.assetBadge}>{formatStageAssetType(element.media_type)}</span>
                </div>

                {(element.media_type === "image" || element.media_type === "video") ? (
                  <div className={styles.liveQuickGrid}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>X%</span>
                      <input
                        className={styles.textInput}
                        type="number"
                        min={0}
                        max={100}
                        value={element.display_x_percent}
                        onBlur={(event) =>
                          void handleActiveElementFieldUpdate(
                            element,
                            "displayXPercent",
                            event.target.value
                          )
                        }
                      />
                    </label>

                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Y%</span>
                      <input
                        className={styles.textInput}
                        type="number"
                        min={0}
                        max={100}
                        value={element.display_y_percent}
                        onBlur={(event) =>
                          void handleActiveElementFieldUpdate(
                            element,
                            "displayYPercent",
                            event.target.value
                          )
                        }
                      />
                    </label>

                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Tamanho%</span>
                      <input
                        className={styles.textInput}
                        type="number"
                        min={5}
                        max={150}
                        value={element.display_size_percent}
                        onBlur={(event) =>
                          void handleActiveElementFieldUpdate(
                            element,
                            "displaySizePercent",
                            event.target.value
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}

                {element.media_type === "sound" ? (
                  <div className={styles.liveQuickGrid}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Volume%</span>
                      <input
                        className={styles.textInput}
                        type="number"
                        min={0}
                        max={100}
                        value={element.audio_volume_percent}
                        onBlur={(event) =>
                          void handleActiveElementFieldUpdate(
                            element,
                            "audioVolumePercent",
                            event.target.value
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}

                <div className={styles.assetActions}>
                  <button
                    className={styles.ghostButton}
                    type="button"
                    disabled={busyActiveElementId === element.id}
                    onClick={() => void handleRemoveActiveElement(element)}
                  >
                    {busyActiveElementId === element.id ? "Removendo..." : "Parar e remover"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {editingAsset && editStyleDraft ? (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <p className={styles.eyebrow}>Editor visual</p>
              <h2 className={styles.cardTitle}>Ajustar {editingAsset.name}</h2>
            </div>
            <span className={styles.sideHint}>
              {formatStageAssetType(editingAsset.media_type)} | {editingAsset.command}
            </span>
          </div>

          <form className={styles.assetForm} onSubmit={handleSaveAssetEdit}>
            <StageAssetConfigurator
              title="Preview do asset salvo"
              helperText="Essa edicao altera como o asset sera exibido na live nas proximas vezes."
              mediaType={editingAsset.media_type}
              previewUrl={editingAsset.media_url}
              assetName={editingAsset.name}
              draft={editStyleDraft}
              onFieldChange={updateEditStyleDraft}
            />

            <div className={styles.formFooter}>
              <button className={styles.ghostButton} type="button" onClick={cancelEditingAsset}>
                Cancelar
              </button>
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={busyAssetId === editingAsset.id}
              >
                {busyAssetId === editingAsset.id ? "Salvando..." : "Salvar visual"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

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
                        <p className={styles.assetMeta}>{summarizeStageAssetVisual(asset)}</p>
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
                        className={styles.secondaryButton}
                        type="button"
                        disabled={busyAssetId === asset.id}
                        onClick={() => startEditingAsset(asset)}
                      >
                        Editar visual
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
                        <p className={styles.assetMeta}>{summarizeStageAssetVisual(asset)}</p>
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
                        className={styles.secondaryButton}
                        type="button"
                        disabled={busyAssetId === asset.id}
                        onClick={() => startEditingAsset(asset)}
                      >
                        Editar visual
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
                        <p className={styles.assetMeta}>{summarizeStageAssetVisual(asset)}</p>
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
                        className={styles.secondaryButton}
                        type="button"
                        disabled={busyAssetId === asset.id}
                        onClick={() => startEditingAsset(asset)}
                      >
                        Editar visual
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
