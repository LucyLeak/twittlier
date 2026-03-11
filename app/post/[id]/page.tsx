"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AccountRow, ensureAccountExists, getSeedFromUser } from "@/lib/account-utils";
import { getSessionUserWithRetry } from "@/lib/session-utils";

type MediaType = "image" | "video" | "gif" | null;

type PostRecord = {
  id: string;
  user_id: string;
  parent_post_id?: string | null;
  content: string | null;
  media_url: string | null;
  media_type: MediaType;
  created_at: string;
  accounts: AccountRow | AccountRow[] | null;
};

type PostQueryRow = Omit<PostRecord, "accounts">;

function getAccountFromPost(post: PostRecord) {
  if (!post.accounts) return null;
  if (Array.isArray(post.accounts)) return post.accounts[0] ?? null;
  return post.accounts;
}

function isValidPostId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default function PostDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const postId = String(params?.id || "");

  const [origin, setOrigin] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [currentAccount, setCurrentAccount] = useState<AccountRow | null>(null);
  const [post, setPost] = useState<PostRecord | null>(null);
  const [replies, setReplies] = useState<PostRecord[]>([]);
  const [postLikes, setPostLikes] = useState<{ count: number; liked: boolean }>({
    count: 0,
    liked: false
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isLikePending, setIsLikePending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOrigin(window.location.origin);
  }, []);

  function getPostUrl() {
    return origin ? `${origin}/post/${postId}` : `/post/${postId}`;
  }

  async function copyPostLink() {
    const url = getPostUrl();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setStatus("Link do post copiado.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Nao foi possivel copiar o link."
      );
    }
  }

  async function loadPost() {
    setError("");
    setStatus("");

    if (!isValidPostId(postId)) {
      setError("Post invalido.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { user: sessionUser, error: sessionError } = await getSessionUserWithRetry(supabase);
    if (!sessionUser) {
      if (sessionError) {
        setError(sessionError.message);
      } else {
        setError("Sessao expirada. Faca login novamente.");
      }
      router.replace("/auth");
      return;
    }

    setUser(sessionUser);
    const ensured = await ensureAccountExists(supabase, getSeedFromUser(sessionUser));
    setCurrentAccount(ensured);

    const { data: postRaw, error: postError } = await supabase
      .from("posts")
      .select(
        "id, user_id, parent_post_id, content, media_url, media_type, created_at, accounts (user_id, name, handle, youtube_account, profile_photo_url, theme_preference, notifications_enabled, email_verified_optional, email_verified_at, is_moderator)"
      )
      .eq("id", postId)
      .maybeSingle();

    if (postError) throw postError;
    if (!postRaw) {
      setError("Post nao encontrado.");
      return;
    }

    setPost(postRaw as PostRecord);

    const { data: repliesRaw, error: repliesError } = await supabase
      .from("posts")
      .select(
        "id, user_id, parent_post_id, content, media_url, media_type, created_at, accounts (user_id, name, handle, youtube_account, profile_photo_url, theme_preference, notifications_enabled, email_verified_optional, email_verified_at, is_moderator)"
      )
      .eq("parent_post_id", postId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (repliesError) throw repliesError;
    setReplies((repliesRaw as PostRecord[]) ?? []);

    const { data: likesRaw, error: likesError } = await supabase
      .from("post_likes")
      .select("post_id, user_id")
      .eq("post_id", postId);

    if (likesError) throw likesError;
    const likesList = (likesRaw as Array<{ post_id: string; user_id: string }>) ?? [];
    setPostLikes({
      count: likesList.length,
      liked: likesList.some((row) => row.user_id === sessionUser.id)
    });
  }

  async function toggleLike() {
    if (!post || !currentAccount || isLikePending) return;
    setError("");
    setStatus("");
    setIsLikePending(true);

    const supabase = getSupabaseBrowserClient();
    const currentLikes = postLikes;
    const optimistic = {
      count: currentLikes.liked ? Math.max(0, currentLikes.count - 1) : currentLikes.count + 1,
      liked: !currentLikes.liked
    };
    setPostLikes(optimistic);

    try {
      if (currentLikes.liked) {
        const { error: deleteError } = await supabase
          .from("post_likes")
          .delete()
          .match({ post_id: post.id, user_id: currentAccount.user_id });
        if (deleteError) throw deleteError;
      } else {
        const { error: insertError } = await supabase.from("post_likes").insert({
          post_id: post.id,
          user_id: currentAccount.user_id
        });
        if (insertError) throw insertError;

        if (post.user_id !== currentAccount.user_id) {
          await supabase.from("notifications").insert({
            recipient_user_id: post.user_id,
            actor_user_id: currentAccount.user_id,
            type: "like",
            post_id: post.id
          });
        }
      }
      setStatus(currentLikes.liked ? "Curtida removida." : "Post curtido.");
    } catch (caughtError) {
      setPostLikes(currentLikes);
      setError(caughtError instanceof Error ? caughtError.message : "Falha ao processar curtida.");
    } finally {
      setIsLikePending(false);
    }
  }

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    loadPost()
      .catch((caughtError) => {
        if (!active) return;
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Falha ao carregar post.";
        setError(messageText);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [postId]);

  const author = useMemo(() => (post ? getAccountFromPost(post) : null), [post]);

  if (isLoading) {
    return (
      <main className="tw-page-shell">
        <section className="tw-card">
          <h1 className="tw-section-title">Post</h1>
          <p>Carregando post...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="tw-page-shell">
      <section className="tw-card">
        <div className="tw-inline-actions tw-inline-between">
          <h1 className="tw-section-title">Post</h1>
          <div className="tw-inline-actions">
            <button className="retro-button" type="button" onClick={() => router.push("/")}>
              Voltar ao feed
            </button>
            {author?.handle ? (
              <button
                className="retro-button"
                type="button"
                onClick={() => router.push(`/perfil/${author.handle}`)}
              >
                Ver perfil
              </button>
            ) : null}
          </div>
        </div>
        {status ? <p className="retro-muted">{status}</p> : null}
        {error ? <p className="retro-error">{error}</p> : null}
      </section>

      {post ? (
        <section className="tw-card">
          <article className="tw-post-card">
            <div className="tw-post-header">
              <div className="tw-post-author">
                {author?.profile_photo_url ? (
                  <img className="tw-avatar" src={author.profile_photo_url} alt={`Foto de ${author.name}`} />
                ) : (
                  <div className="tw-avatar fallback">
                    {(author?.name || "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <div className="tw-post-name">
                    {author?.name || "Anon"}
                    {author?.is_moderator ? <span className="tw-role-chip">MOD</span> : null}
                  </div>
                  <div className="tw-post-handle">@{author?.handle || "anon"}</div>
                </div>
              </div>
              <time className="post-time">{new Date(post.created_at).toLocaleString("pt-BR")}</time>
            </div>

            <div className="tw-post-body">
              {post.content ? <p className="post-text">{post.content}</p> : null}
              {post.media_url && post.media_type === "video" ? (
                <video className="tw-post-media" src={post.media_url} controls />
              ) : null}
              {post.media_url && post.media_type !== "video" ? (
                <img className="tw-post-media" src={post.media_url} alt="Midia do post" />
              ) : null}
            </div>

            {(postLikes.count > 0 || replies.length > 0) ? (
              <div className="tw-post-engagement" aria-label="Resumo de interacoes">
                <span className="tw-meta-chip">{postLikes.count} curtidas</span>
                <span className="tw-meta-chip">{replies.length} comentarios</span>
              </div>
            ) : null}

            <div className="tw-post-actions">
              <button
                className="retro-button tw-small-button tw-action-button"
                type="button"
                data-active={postLikes.liked ? "true" : "false"}
                aria-pressed={postLikes.liked}
                disabled={isLikePending || !currentAccount}
                onClick={toggleLike}
              >
                {isLikePending ? "Salvando..." : postLikes.liked ? "Curtido" : "Curtir"}
                <span className="tw-action-count">{postLikes.count}</span>
              </button>
              <button className="retro-button tw-small-button" type="button" onClick={copyPostLink}>
                Copiar link
              </button>
              <a className="retro-button tw-small-button" href={getPostUrl()} target="_blank" rel="noreferrer">
                Abrir em nova aba
              </a>
            </div>
          </article>
        </section>
      ) : null}

      <section className="tw-card">
        <h2 className="tw-section-title">Respostas</h2>
        {replies.length === 0 ? (
          <p className="retro-muted">Sem respostas ainda.</p>
        ) : (
          <div className="tw-feed-list">
            {replies.map((reply) => {
              const replyAuthor = getAccountFromPost(reply);
              return (
                <article className="tw-post-card tw-post-reply-card" key={reply.id}>
                  <div className="tw-post-header">
                    <div className="tw-post-author">
                      {replyAuthor?.profile_photo_url ? (
                        <img
                          className="tw-avatar"
                          src={replyAuthor.profile_photo_url}
                          alt={`Foto de ${replyAuthor.name}`}
                        />
                      ) : (
                        <div className="tw-avatar fallback">
                          {(replyAuthor?.name || "?").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="tw-post-name">
                          {replyAuthor?.name || "Anon"}
                          {replyAuthor?.is_moderator ? (
                            <span className="tw-role-chip">MOD</span>
                          ) : null}
                        </div>
                        <div className="tw-post-handle">@{replyAuthor?.handle || "anon"}</div>
                      </div>
                    </div>
                    <time className="post-time">
                      {new Date(reply.created_at).toLocaleString("pt-BR")}
                    </time>
                  </div>
                  {reply.content ? <p className="post-text">{reply.content}</p> : null}
                  {reply.media_url && reply.media_type === "video" ? (
                    <video className="tw-post-media" src={reply.media_url} controls />
                  ) : null}
                  {reply.media_url && reply.media_type !== "video" ? (
                    <img className="tw-post-media" src={reply.media_url} alt="Midia da resposta" />
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
