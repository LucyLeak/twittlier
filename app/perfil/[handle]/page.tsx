"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AccountRow, ensureAccountExists, getSeedFromUser, normalizeHandle } from "@/lib/account-utils";

type MediaType = "image" | "video" | "gif" | null;

type PostRecord = {
  id: string;
  user_id: string;
  content: string | null;
  media_url: string | null;
  media_type: MediaType;
  created_at: string;
};

type FollowCountState = {
  followers: number;
  following: number;
};

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams<{ handle: string }>();
  const routeHandle = useMemo(() => normalizeHandle(String(params?.handle || "")), [params]);

  const [viewerUser, setViewerUser] = useState<User | null>(null);
  const [viewerAccount, setViewerAccount] = useState<AccountRow | null>(null);
  const [targetAccount, setTargetAccount] = useState<AccountRow | null>(null);
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [counts, setCounts] = useState<FollowCountState>({ followers: 0, following: 0 });
  const [isFollowing, setIsFollowing] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedByTarget, setBlockedByTarget] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function loadData() {
    const supabase = getSupabaseBrowserClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      router.replace("/auth");
      return;
    }

    setViewerUser(sessionData.session.user);

    const ensuredViewer = await ensureAccountExists(supabase, getSeedFromUser(sessionData.session.user));
    setViewerAccount(ensuredViewer);

    const { data: target, error: targetError } = await supabase
      .from("accounts")
      .select(
        "user_id, name, handle, youtube_account, profile_photo_url, email_verified_optional, email_verified_at, is_moderator"
      )
      .eq("handle", routeHandle)
      .maybeSingle();

    if (targetError) throw targetError;
    if (!target) {
      throw new Error("Perfil nao encontrado.");
    }

    const targetTyped = target as AccountRow;
    setTargetAccount(targetTyped);

    const [
      postsResult,
      followersCountResult,
      followingCountResult,
      followingEdgeResult,
      blockEdgeResult,
      blockedByEdgeResult
    ] = await Promise.all([
      supabase
        .from("posts")
        .select("id, user_id, content, media_url, media_type, created_at")
        .eq("user_id", targetTyped.user_id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("following_user_id", targetTyped.user_id),
      supabase
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("follower_user_id", targetTyped.user_id),
      supabase
        .from("follows")
        .select("follower_user_id")
        .eq("follower_user_id", ensuredViewer.user_id)
        .eq("following_user_id", targetTyped.user_id)
        .maybeSingle(),
      supabase
        .from("blocks")
        .select("blocker_user_id")
        .eq("blocker_user_id", ensuredViewer.user_id)
        .eq("blocked_user_id", targetTyped.user_id)
        .maybeSingle(),
      supabase
        .from("blocks")
        .select("blocker_user_id")
        .eq("blocker_user_id", targetTyped.user_id)
        .eq("blocked_user_id", ensuredViewer.user_id)
        .maybeSingle()
    ]);

    if (postsResult.error) throw postsResult.error;
    if (followersCountResult.error) throw followersCountResult.error;
    if (followingCountResult.error) throw followingCountResult.error;
    if (followingEdgeResult.error) throw followingEdgeResult.error;
    if (blockEdgeResult.error) throw blockEdgeResult.error;
    if (blockedByEdgeResult.error) throw blockedByEdgeResult.error;

    setCounts({
      followers: followersCountResult.count || 0,
      following: followingCountResult.count || 0
    });
    setIsFollowing(Boolean(followingEdgeResult.data));
    setIsBlocked(Boolean(blockEdgeResult.data));
    setBlockedByTarget(Boolean(blockedByEdgeResult.data));
    setPosts((postsResult.data as PostRecord[]) ?? []);
  }

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setStatus("");
    setError("");

    loadData()
      .catch((caughtError) => {
        if (!active) return;
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Falha ao carregar perfil.";
        setError(messageText);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [routeHandle]);

  async function toggleFollow() {
    if (!viewerAccount || !targetAccount || viewerAccount.user_id === targetAccount.user_id) return;
    setError("");
    setStatus("");
    setIsActionLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (isFollowing) {
        const { error: deleteError } = await supabase
          .from("follows")
          .delete()
          .eq("follower_user_id", viewerAccount.user_id)
          .eq("following_user_id", targetAccount.user_id);
        if (deleteError) throw deleteError;
        setStatus(`Voce deixou de seguir @${targetAccount.handle}.`);
      } else {
        const { error: insertError } = await supabase.from("follows").insert({
          follower_user_id: viewerAccount.user_id,
          following_user_id: targetAccount.user_id
        });
        if (insertError) throw insertError;
        setStatus(`Voce agora segue @${targetAccount.handle}.`);
      }
      await loadData();
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao atualizar follow.";
      setError(messageText);
    } finally {
      setIsActionLoading(false);
    }
  }

  async function toggleBlock() {
    if (!viewerAccount || !targetAccount || viewerAccount.user_id === targetAccount.user_id) return;
    setError("");
    setStatus("");
    setIsActionLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (isBlocked) {
        const { error: deleteError } = await supabase
          .from("blocks")
          .delete()
          .eq("blocker_user_id", viewerAccount.user_id)
          .eq("blocked_user_id", targetAccount.user_id);
        if (deleteError) throw deleteError;
        setStatus(`@${targetAccount.handle} foi desbloqueado.`);
      } else {
        const { error: insertError } = await supabase.from("blocks").insert({
          blocker_user_id: viewerAccount.user_id,
          blocked_user_id: targetAccount.user_id
        });
        if (insertError) throw insertError;

        const { error: cleanupForwardError } = await supabase
          .from("follows")
          .delete()
          .eq("follower_user_id", viewerAccount.user_id)
          .eq("following_user_id", targetAccount.user_id);
        if (cleanupForwardError) throw cleanupForwardError;

        const { error: cleanupReverseError } = await supabase
          .from("follows")
          .delete()
          .eq("follower_user_id", targetAccount.user_id)
          .eq("following_user_id", viewerAccount.user_id);
        if (cleanupReverseError) throw cleanupReverseError;
        setStatus(`@${targetAccount.handle} foi bloqueado.`);
      }
      await loadData();
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao atualizar bloqueio.";
      setError(messageText);
    } finally {
      setIsActionLoading(false);
    }
  }

  async function deletePost(postId: string) {
    if (!viewerAccount) return;
    setError("");
    setStatus("");
    setIsActionLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: deleteError } = await supabase.from("posts").delete().eq("id", postId);
      if (deleteError) throw deleteError;
      setStatus("Post removido.");
      await loadData();
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Nao foi possivel remover o post.";
      setError(messageText);
    } finally {
      setIsActionLoading(false);
    }
  }

  const isOwnProfile =
    viewerAccount && targetAccount ? viewerAccount.user_id === targetAccount.user_id : false;

  const canSeePosts = !isBlocked && !blockedByTarget;
  const canModeratePosts = Boolean(viewerAccount?.is_moderator);

  if (isLoading) {
    return (
      <main className="tw-page-shell">
        <section className="tw-card">
          <h1 className="tw-section-title">Carregando perfil...</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="tw-page-shell">
      <section className="tw-card">
        <div className="tw-inline-actions tw-inline-between">
          <h1 className="tw-section-title">
            {targetAccount?.name || "Perfil"}{" "}
            {targetAccount?.is_moderator ? <span className="tw-role-chip">MOD</span> : null}
          </h1>
          <button className="retro-button" type="button" onClick={() => router.push("/")}>
            Voltar ao feed
          </button>
        </div>

        <div className="tw-profile-head">
          {targetAccount?.profile_photo_url ? (
            <img className="tw-profile-avatar" src={targetAccount.profile_photo_url} alt="Foto de perfil" />
          ) : (
            <div className="tw-profile-avatar fallback">
              {(targetAccount?.name || "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <p className="tw-profile-name">{targetAccount?.name || "Perfil"}</p>
            <p className="tw-profile-handle">@{targetAccount?.handle || "desconhecido"}</p>
            {targetAccount?.youtube_account ? (
              <p className="retro-muted">YouTube: {targetAccount.youtube_account}</p>
            ) : null}
          </div>
        </div>

        <div className="tw-inline-actions">
          <span className="retro-muted">{counts.followers} seguidores</span>
          <span className="retro-muted">{counts.following} seguindo</span>
        </div>

        {!isOwnProfile ? (
          <div className="tw-inline-actions">
            <button className="retro-button primary" type="button" onClick={toggleFollow} disabled={isActionLoading || isBlocked || blockedByTarget}>
              {isFollowing ? "Unfollow" : "Follow"}
            </button>
            <button className="retro-button danger" type="button" onClick={toggleBlock} disabled={isActionLoading}>
              {isBlocked ? "Unblock" : "Block"}
            </button>
          </div>
        ) : (
          <div className="tw-inline-actions">
            <button className="retro-button" type="button" onClick={() => router.push("/configuracoes")}>
              Editar perfil
            </button>
          </div>
        )}

        {blockedByTarget ? <p className="retro-error">Voce foi bloqueado por esse usuario.</p> : null}
        {isBlocked ? <p className="retro-muted">Voce bloqueou esse usuario.</p> : null}
        {status ? <p className="retro-muted">{status}</p> : null}
        {error ? <p className="retro-error">{error}</p> : null}
      </section>

      <section className="tw-card">
        <h2 className="tw-section-title">Posts</h2>
        {!canSeePosts ? (
          <p className="retro-muted">Posts indisponiveis por bloqueio.</p>
        ) : posts.length === 0 ? (
          <p className="retro-muted">Sem posts ainda.</p>
        ) : (
          <div className="tw-feed-list">
            {posts.map((post) => (
              <article className="tw-post-card" key={post.id}>
                <div className="tw-post-header">
                  <time className="post-time">{new Date(post.created_at).toLocaleString("pt-BR")}</time>
                  {(isOwnProfile || canModeratePosts) ? (
                    <button
                      className="retro-button danger tw-small-button"
                      type="button"
                      onClick={() => deletePost(post.id)}
                      disabled={isActionLoading}
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
                {post.content ? <p className="post-text">{post.content}</p> : null}
                {post.media_url && post.media_type === "video" ? (
                  <video className="tw-post-media" src={post.media_url} controls />
                ) : null}
                {post.media_url && post.media_type !== "video" ? (
                  <img className="tw-post-media" src={post.media_url} alt="Midia do post" />
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
