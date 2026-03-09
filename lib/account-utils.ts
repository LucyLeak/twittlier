import { SupabaseClient, User } from "@supabase/supabase-js";

export type AccountRow = {
  user_id: string;
  name: string;
  handle: string;
  youtube_account: string | null;
  profile_photo_url: string | null;
  email_verified_optional: boolean;
  email_verified_at: string | null;
  is_moderator: boolean;
};

export function normalizeHandle(source: string) {
  const base = source.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  if (base.length >= 3) return base;
  return `user${Math.floor(1000 + Math.random() * 9000)}`;
}

export function normalizeName(source: string, fallbackHandle: string) {
  const clean = source.trim().slice(0, 60);
  if (clean.length > 0) return clean;
  return fallbackHandle;
}

type AccountSeed = {
  userId: string;
  email?: string;
  name?: string;
  handle?: string;
  youtubeAccount?: string;
  profilePhotoUrl?: string;
};

export function getSeedFromUser(user: User): AccountSeed {
  const metadata = user.user_metadata ?? {};
  const fallback = user.email?.split("@")[0] || "user";

  const candidateHandle =
    typeof metadata.handle === "string"
      ? metadata.handle
      : typeof metadata.user_name === "string"
        ? metadata.user_name
        : fallback;

  const candidateName =
    typeof metadata.name === "string"
      ? metadata.name
      : typeof metadata.full_name === "string"
        ? metadata.full_name
        : fallback;

  const candidateYoutube =
    typeof metadata.youtube_account === "string" ? metadata.youtube_account : "";

  const candidatePhoto =
    typeof metadata.profile_photo_url === "string"
      ? metadata.profile_photo_url
      : typeof metadata.avatar_url === "string"
        ? metadata.avatar_url
        : typeof metadata.picture === "string"
          ? metadata.picture
          : "";

  return {
    userId: user.id,
    email: user.email || "",
    name: candidateName,
    handle: candidateHandle,
    youtubeAccount: candidateYoutube,
    profilePhotoUrl: candidatePhoto
  };
}

async function fetchAccountByUserId(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("accounts")
    .select(
      "user_id, name, handle, youtube_account, profile_photo_url, email_verified_optional, email_verified_at, is_moderator"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as AccountRow | null) ?? null;
}

export async function ensureAccountExists(supabase: SupabaseClient, seed: AccountSeed) {
  const existing = await fetchAccountByUserId(supabase, seed.userId);
  if (existing) return existing;

  const baseHandle = normalizeHandle(seed.handle || seed.email?.split("@")[0] || "user");
  const accountName = normalizeName(seed.name || "", baseHandle);
  const youtubeValue = seed.youtubeAccount?.trim() || null;
  const photoValue = seed.profilePhotoUrl?.trim() || null;

  const handleOptions = [baseHandle];
  for (let index = 0; index < 7; index += 1) {
    const suffix = `${Math.floor(10000 + Math.random() * 90000)}`;
    handleOptions.push(`${baseHandle.slice(0, 19)}${suffix}`.slice(0, 24));
  }

  for (const handleOption of handleOptions) {
    const { error: insertError } = await supabase.from("accounts").insert({
      user_id: seed.userId,
      name: accountName,
      handle: handleOption,
      youtube_account: youtubeValue,
      profile_photo_url: photoValue
    });

    if (!insertError) {
      const inserted = await fetchAccountByUserId(supabase, seed.userId);
      if (inserted) return inserted;
      break;
    }

    if (insertError.code !== "23505") {
      throw insertError;
    }

    const raceAccount = await fetchAccountByUserId(supabase, seed.userId);
    if (raceAccount) return raceAccount;
  }

  throw new Error("Nao foi possivel preparar a conta.");
}
