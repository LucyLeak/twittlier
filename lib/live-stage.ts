export type StageAssetType = "sound" | "image" | "video";

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
  triggered_by_user_id: string;
  triggered_by_handle: string;
  created_at: string;
};

export const DEFAULT_STAGE_IMAGE_DURATION_SECONDS = 8;
export const MIN_STAGE_IMAGE_DURATION_SECONDS = 2;
export const MAX_STAGE_IMAGE_DURATION_SECONDS = 120;
export const STAGE_EVENT_RETENTION_HOURS = 6;
export const STAGE_OVERLAY_POLL_MS = 2500;
export const STAGE_PANEL_POLL_MS = 4000;
export const STAGE_SOUND_NOTICE_MS = 4500;

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

export function extractStoragePathFromPublicUrl(url: string, bucketName: string) {
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.slice(index + marker.length));
}
