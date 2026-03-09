"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  AccountRow,
  ensureAccountExists,
  getSeedFromUser,
  normalizeHandle,
  normalizeName
} from "@/lib/account-utils";

function formatDate(value: string | null) {
  if (!value) return "Nao confirmado";
  return new Date(value).toLocaleString("pt-BR");
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsPage() {
  const router = useRouter();
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [youtubeAccount, setYoutubeAccount] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreviewUrl, setProfilePhotoPreviewUrl] = useState("");
  const [removeCurrentPhoto, setRemoveCurrentPhoto] = useState(false);
  const [modTargetHandle, setModTargetHandle] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isModSaving, setIsModSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function fillFormFromAccount(source: AccountRow) {
    setName(source.name);
    setHandle(source.handle);
    setYoutubeAccount(source.youtube_account || "");
    setProfilePhotoUrl(source.profile_photo_url || null);
    setProfilePhotoPreviewUrl(source.profile_photo_url || "");
    setProfilePhotoFile(null);
    setRemoveCurrentPhoto(false);
    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
  }

  async function loadData() {
    const supabase = getSupabaseBrowserClient();
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session?.user) {
      router.replace("/auth");
      return;
    }

    setUser(data.session.user);
    const ensured = await ensureAccountExists(supabase, getSeedFromUser(data.session.user));
    setAccount(ensured);
    fillFormFromAccount(ensured);
  }

  useEffect(() => {
    let active = true;
    loadData()
      .catch((caughtError) => {
        if (!active) return;
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Falha ao carregar configuracoes.";
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
    if (!profilePhotoFile) return;
    const tempUrl = URL.createObjectURL(profilePhotoFile);
    setProfilePhotoPreviewUrl(tempUrl);
    return () => URL.revokeObjectURL(tempUrl);
  }, [profilePhotoFile]);

  function onPhotoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;

    if (!selected.type.startsWith("image/")) {
      setError("A foto de perfil precisa ser uma imagem.");
      return;
    }

    if (selected.size > 10 * 1024 * 1024) {
      setError("A imagem precisa ter no maximo 10MB.");
      return;
    }

    setError("");
    setProfilePhotoFile(selected);
    setRemoveCurrentPhoto(false);
  }

  function removePhotoSelection() {
    setProfilePhotoFile(null);
    setRemoveCurrentPhoto(true);
    setProfilePhotoPreviewUrl("");
    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
  }

  async function uploadProfilePhoto(userId: string) {
    if (!profilePhotoFile) return null;
    const supabase = getSupabaseBrowserClient();
    const extension = profilePhotoFile.name.split(".").pop() || "jpg";
    const filePath = `${userId}/avatar-${Date.now()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("profile-media")
      .upload(filePath, profilePhotoFile, {
        upsert: false,
        contentType: profilePhotoFile.type
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("profile-media").getPublicUrl(filePath);
    return data.publicUrl;
  }

  async function onSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    setError("");

    if (!user) {
      setError("Sessao invalida. Faca login novamente.");
      return;
    }

    setIsSaving(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const cleanHandle = normalizeHandle(handle || user.email?.split("@")[0] || "user");
      const cleanName = normalizeName(name, cleanHandle);
      const cleanYoutube = youtubeAccount.trim() || null;
      let cleanPhoto = profilePhotoUrl;

      if (removeCurrentPhoto) {
        cleanPhoto = null;
      } else if (profilePhotoFile) {
        cleanPhoto = await uploadProfilePhoto(user.id);
      }

      const { data: updatedAccount, error: updateError } = await supabase
        .from("accounts")
        .update({
          name: cleanName,
          handle: cleanHandle,
          youtube_account: cleanYoutube,
          profile_photo_url: cleanPhoto
        })
        .eq("user_id", user.id)
        .select(
          "user_id, name, handle, youtube_account, profile_photo_url, email_verified_optional, email_verified_at, is_moderator"
        )
        .single();

      if (updateError) {
        if (updateError.code === "23505") {
          throw new Error("Esse @ ja esta em uso.");
        }
        throw updateError;
      }

      const normalized = updatedAccount as AccountRow;
      setAccount(normalized);
      fillFormFromAccount(normalized);
      setStatus("Perfil atualizado.");
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Erro ao atualizar perfil.";
      setError(messageText);
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmEmailNow() {
    setStatus("");
    setError("");

    if (!user) {
      setError("Sessao invalida. Faca login novamente.");
      return;
    }

    setIsSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const supabase = getSupabaseBrowserClient();
      const { data: updatedAccount, error: updateError } = await supabase
        .from("accounts")
        .update({
          email_verified_optional: true,
          email_verified_at: nowIso
        })
        .eq("user_id", user.id)
        .select(
          "user_id, name, handle, youtube_account, profile_photo_url, email_verified_optional, email_verified_at, is_moderator"
        )
        .single();

      if (updateError) throw updateError;
      setAccount(updatedAccount as AccountRow);
      setStatus("Email marcado como confirmado.");
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao confirmar email.";
      setError(messageText);
    } finally {
      setIsSaving(false);
    }
  }

  async function setModeratorRole(nextValue: boolean) {
    setStatus("");
    setError("");

    if (!account?.is_moderator) {
      setError("Apenas moderadores podem alterar permissoes.");
      return;
    }

    const target = normalizeHandle(modTargetHandle);
    if (!target) {
      setError("Informe um @ valido.");
      return;
    }

    setIsModSaving(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: updatedTarget, error: updateError } = await supabase
        .from("accounts")
        .update({ is_moderator: nextValue })
        .eq("handle", target)
        .select("handle, is_moderator")
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updatedTarget) {
        throw new Error("Usuario nao encontrado para esse @.");
      }

      setStatus(`Permissao atualizada: @${updatedTarget.handle} -> ${nextValue ? "MOD" : "USER"}.`);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Erro ao alterar moderador.";
      setError(messageText);
    } finally {
      setIsModSaving(false);
    }
  }

  if (isLoading) {
    return (
      <main className="tw-page-shell">
        <section className="tw-card">
          <h1 className="tw-section-title">Configuracoes</h1>
          <p>Carregando...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="tw-page-shell">
      <section className="tw-card">
        <h1 className="tw-section-title">Configuracoes da conta</h1>
        <div className="tw-inline-actions">
          <button className="retro-button" type="button" onClick={() => router.push("/")}>
            Voltar ao feed
          </button>
          {account?.handle ? (
            <button
              className="retro-button"
              type="button"
              onClick={() => router.push(`/perfil/${account.handle}`)}
            >
              Ver meu perfil
            </button>
          ) : null}
        </div>
      </section>

      <section className="tw-card">
        <h2 className="tw-section-title">Perfil</h2>
        <form className="retro-form" onSubmit={onSaveProfile}>
          <label htmlFor="settings-name">Nome</label>
          <input
            id="settings-name"
            className="retro-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Seu nome publico"
          />

          <label htmlFor="settings-handle">@</label>
          <input
            id="settings-handle"
            className="retro-input"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="ex: joao_90"
          />

          <label htmlFor="settings-youtube">YouTube</label>
          <input
            id="settings-youtube"
            className="retro-input"
            value={youtubeAccount}
            onChange={(event) => setYoutubeAccount(event.target.value)}
            placeholder="@canal ou URL"
          />

          <label htmlFor="settings-photo-file">Foto de perfil (arquivo)</label>
          <input
            ref={photoInputRef}
            id="settings-photo-file"
            className="tw-file-input-hidden"
            type="file"
            accept="image/*"
            onChange={onPhotoFileChange}
          />
          <label
            htmlFor="settings-photo-file"
            className="tw-upload-box"
            data-has-file={profilePhotoFile ? "true" : "false"}
          >
            <span className="tw-upload-title">
              {profilePhotoFile ? "Nova foto selecionada" : "Selecionar foto de perfil"}
            </span>
            <span className="tw-upload-meta">
              {profilePhotoFile
                ? `${profilePhotoFile.name} (${formatBytes(profilePhotoFile.size)})`
                : "Clique para escolher uma imagem"}
            </span>
          </label>

          {profilePhotoPreviewUrl ? (
            <img className="tw-profile-photo-preview" src={profilePhotoPreviewUrl} alt="Previa da foto" />
          ) : (
            <p className="retro-muted">Sem foto de perfil.</p>
          )}

          <div className="tw-inline-actions">
            <button className="retro-button" type="button" onClick={removePhotoSelection}>
              Remover foto atual
            </button>
          </div>

          <button className="retro-button primary" type="submit" disabled={isSaving}>
            {isSaving ? "Salvando..." : "Salvar perfil"}
          </button>
        </form>
      </section>

      <section className="tw-card">
        <h2 className="tw-section-title">Email opcional</h2>
        <p className="retro-muted">
          Status atual: {account?.email_verified_optional ? "Confirmado" : "Pendente"}
        </p>
        <p className="retro-muted">Data: {formatDate(account?.email_verified_at || null)}</p>
        <button className="retro-button primary" type="button" onClick={confirmEmailNow} disabled={isSaving}>
          {isSaving ? "Salvando..." : "Confirmar email"}
        </button>
      </section>

      <section className="tw-card">
        <h2 className="tw-section-title">Permissoes</h2>
        <p className="retro-muted">
          Perfil atual: {account?.is_moderator ? "Moderador" : "Usuario comum"}
        </p>
        {account?.is_moderator ? (
          <div className="retro-form">
            <label htmlFor="mod-target">@ do usuario</label>
            <input
              id="mod-target"
              className="retro-input"
              value={modTargetHandle}
              onChange={(event) => setModTargetHandle(event.target.value)}
              placeholder="ex: maria_90"
            />
            <div className="tw-inline-actions">
              <button
                className="retro-button primary"
                type="button"
                onClick={() => setModeratorRole(true)}
                disabled={isModSaving}
              >
                Tornar moderador
              </button>
              <button
                className="retro-button danger"
                type="button"
                onClick={() => setModeratorRole(false)}
                disabled={isModSaving}
              >
                Remover moderador
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="tw-card">
        <h2 className="tw-section-title">Sessao</h2>
        <p className="retro-muted">Logado como: {user?.email || "Nao identificado"}</p>
        {status ? <p className="retro-muted">{status}</p> : null}
        {error ? <p className="retro-error">{error}</p> : null}
      </section>
    </main>
  );
}
