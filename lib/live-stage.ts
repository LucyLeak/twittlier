export type StageAssetType = "sound" | "image" | "video";
export type StageDisplayPosition =
  | "free"
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";
export type StageDisplayFit = "contain" | "cover";
export type StageEntryAnimation = "none" | "fade" | "pop" | "slide-up" | "slide-left";

export type StageAssetRow = {
  id: string;
  room_owner_user_id: string;
  created_by_user_id: string;
  name: string;
  command: string;
  media_url: string;
  media_type: StageAssetType;
  shortcut_key: string | null;
  image_duration_seconds: number | null;
  display_size_percent: number;
  display_x_percent: number;
  display_y_percent: number;
  display_position: StageDisplayPosition;
  display_fit: StageDisplayFit;
  entry_animation: StageEntryAnimation;
  audio_volume_percent: number;
  created_at: string;
  updated_at?: string;
};

export type StageEventRow = {
  id: string;
  room_owner_user_id: string;
  asset_id: string;
  asset_name: string;
  asset_command: string;
  media_url: string;
  media_type: StageAssetType;
  image_duration_seconds: number | null;
  display_size_percent: number;
  display_x_percent: number;
  display_y_percent: number;
  display_position: StageDisplayPosition;
  display_fit: StageDisplayFit;
  entry_animation: StageEntryAnimation;
  audio_volume_percent: number;
  triggered_by_user_id: string;
  triggered_by_handle: string;
  created_at: string;
};

export const DEFAULT_STAGE_IMAGE_DURATION_SECONDS = 8;
export const MIN_STAGE_IMAGE_DURATION_SECONDS = 2;
export const MAX_STAGE_IMAGE_DURATION_SECONDS = 120;
export const DEFAULT_STAGE_DISPLAY_SIZE_PERCENT = 60;
export const MIN_STAGE_DISPLAY_SIZE_PERCENT = 5;
export const MAX_STAGE_DISPLAY_SIZE_PERCENT = 150;
export const DEFAULT_STAGE_DISPLAY_X_PERCENT = 50;
export const DEFAULT_STAGE_DISPLAY_Y_PERCENT = 50;
export const MIN_STAGE_DISPLAY_COORDINATE_PERCENT = 0;
export const MAX_STAGE_DISPLAY_COORDINATE_PERCENT = 100;
export const DEFAULT_STAGE_AUDIO_VOLUME_PERCENT = 100;
export const MIN_STAGE_AUDIO_VOLUME_PERCENT = 0;
export const MAX_STAGE_AUDIO_VOLUME_PERCENT = 100;
export const STAGE_EVENT_RETENTION_HOURS = 6;
export const STAGE_OVERLAY_POLL_MS = 2500;
export const STAGE_PANEL_POLL_MS = 4000;
export const STAGE_SOUND_NOTICE_MS = 4500;
export const STAGE_DISPLAY_POSITION_OPTIONS: StageDisplayPosition[] = [
  "free",
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
];
export const STAGE_DISPLAY_FIT_OPTIONS: StageDisplayFit[] = ["contain", "cover"];
export const STAGE_ENTRY_ANIMATION_OPTIONS: StageEntryAnimation[] = [
  "fade",
  "pop",
  "slide-up",
  "slide-left",
  "none"
];

export function inferStageAssetTypeFromMime(mimeType: string): StageAssetType | null {
  if (!mimeType) return null;
  if (mimeType.startsWith("audio/")) return "sound";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  return null;
}

export function normalizeStageCommand(source: string) {
  const base = source
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9!_-]/g, "")
    .replace(/^!+/, "")
    .slice(0, 32);

  if (base.length < 2) return "";
  return `!${base}`;
}

export function normalizeShortcutKey(source: string) {
  return source.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 24);
}

export function clampStageImageDurationSeconds(input: number | null | undefined) {
  if (!Number.isFinite(input)) return DEFAULT_STAGE_IMAGE_DURATION_SECONDS;
  return Math.min(
    MAX_STAGE_IMAGE_DURATION_SECONDS,
    Math.max(MIN_STAGE_IMAGE_DURATION_SECONDS, Math.round(input || 0))
  );
}

export function clampStageDisplaySizePercent(input: number | null | undefined) {
  if (!Number.isFinite(input)) return DEFAULT_STAGE_DISPLAY_SIZE_PERCENT;
  return Math.min(
    MAX_STAGE_DISPLAY_SIZE_PERCENT,
    Math.max(MIN_STAGE_DISPLAY_SIZE_PERCENT, Math.round(input || 0))
  );
}

export function clampStageDisplayCoordinatePercent(input: number | null | undefined) {
  if (!Number.isFinite(input)) return DEFAULT_STAGE_DISPLAY_X_PERCENT;
  return Math.min(
    MAX_STAGE_DISPLAY_COORDINATE_PERCENT,
    Math.max(MIN_STAGE_DISPLAY_COORDINATE_PERCENT, Math.round(input || 0))
  );
}

export function clampStageAudioVolumePercent(input: number | null | undefined) {
  if (!Number.isFinite(input)) return DEFAULT_STAGE_AUDIO_VOLUME_PERCENT;
  return Math.min(
    MAX_STAGE_AUDIO_VOLUME_PERCENT,
    Math.max(MIN_STAGE_AUDIO_VOLUME_PERCENT, Math.round(input || 0))
  );
}

export function normalizeStageDisplayPosition(source: string): StageDisplayPosition {
  return STAGE_DISPLAY_POSITION_OPTIONS.includes(source as StageDisplayPosition)
    ? (source as StageDisplayPosition)
    : "free";
}

export function normalizeStageDisplayFit(source: string): StageDisplayFit {
  return STAGE_DISPLAY_FIT_OPTIONS.includes(source as StageDisplayFit)
    ? (source as StageDisplayFit)
    : "contain";
}

export function normalizeStageEntryAnimation(source: string): StageEntryAnimation {
  return STAGE_ENTRY_ANIMATION_OPTIONS.includes(source as StageEntryAnimation)
    ? (source as StageEntryAnimation)
    : "fade";
}

export function formatStageAssetType(type: StageAssetType) {
  switch (type) {
    case "sound":
      return "Som";
    case "image":
      return "Imagem";
    case "video":
      return "Video";
    default:
      return type;
  }
}

export function formatStageDisplayPosition(position: StageDisplayPosition) {
  switch (position) {
    case "free":
      return "Livre";
    case "center":
      return "Centro";
    case "top":
      return "Topo";
    case "bottom":
      return "Base";
    case "left":
      return "Esquerda";
    case "right":
      return "Direita";
    case "top-left":
      return "Topo esquerda";
    case "top-right":
      return "Topo direita";
    case "bottom-left":
      return "Base esquerda";
    case "bottom-right":
      return "Base direita";
    default:
      return position;
  }
}

export function formatStageDisplayFit(fit: StageDisplayFit) {
  switch (fit) {
    case "contain":
      return "Mostrar inteiro";
    case "cover":
      return "Cobrir a tela";
    default:
      return fit;
  }
}

export function formatStageEntryAnimation(animation: StageEntryAnimation) {
  switch (animation) {
    case "none":
      return "Sem animacao";
    case "fade":
      return "Fade";
    case "pop":
      return "Pop";
    case "slide-up":
      return "Subir";
    case "slide-left":
      return "Entrar da esquerda";
    default:
      return animation;
  }
}

export function extractStoragePathFromPublicUrl(url: string, bucketName: string) {
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.slice(index + marker.length));
}
