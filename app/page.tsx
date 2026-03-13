"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEventHandler, FormEventHandler, MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AccountRow, ensureAccountExists, getSeedFromUser } from "@/lib/account-utils";
import { getSessionUserWithRetry, isSessionLockError } from "@/lib/session-utils";

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

type TimelineMode = "for_you" | "following";

function getAccountFromPost(post: PostRecord) {
  if (!post.accounts) return null;
  if (Array.isArray(post.accounts)) return post.accounts[0] ?? null;
  return post.accounts;
}

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

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

function LiveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8.5a5 5 0 0 0 0 7" />
      <path d="M16 8.5a5 5 0 0 1 0 7" />
      <path d="M5 5.5a9 9 0 0 0 0 13" />
      <path d="M19 5.5a9 9 0 0 1 0 13" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4" />
      <path d="M12 18.8v2.4" />
      <path d="m4.9 4.9 1.7 1.7" />
      <path d="m17.4 17.4 1.7 1.7" />
      <path d="M2.8 12h2.4" />
      <path d="M18.8 12h2.4" />
      <path d="m4.9 19.1 1.7-1.7" />
      <path d="m17.4 6.6 1.7-1.7" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4H5v16h4" />
      <path d="M13 8l4 4-4 4" />
      <path d="M8 12h9" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="1" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12v7h16v-7" />
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function HeartIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m12 20-1.2-1.1C6.2 14.8 3.5 12.4 3.5 8.9A4.4 4.4 0 0 1 8 4.5c1.5 0 3 .7 4 1.9 1-1.2 2.5-1.9 4-1.9a4.4 4.4 0 0 1 4.5 4.4c0 3.5-2.7 5.9-7.3 10L12 20Z"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6.5h14v9H9l-4 3v-12Z" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-5.5 9.5-5.5S21.5 12 21.5 12s-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4.5 20.5 19" />
      <path d="M10.6 6.7a9.7 9.7 0 0 1 1.4-.2c6 0 9.5 5.5 9.5 5.5a18 18 0 0 1-3.8 4.2" />
      <path d="M6.6 8.2A18.2 18.2 0 0 0 2.5 12s3.5 5.5 9.5 5.5c1.3 0 2.5-.3 3.5-.7" />
      <path d="M9.9 9.9A3 3 0 0 0 12 15a3 3 0 0 0 2.1-.9" />
    </svg>
  );
}

function maskEmail(email: string) {
  const [localPart, domainPart] = email.split("@");
  if (!localPart || !domainPart) return "oculto";

  const [domainName, ...domainSuffix] = domainPart.split(".");
  const maskedLocal =
    localPart.length <= 2
      ? `${localPart.slice(0, 1)}*`
      : `${localPart.slice(0, 2)}${"*".repeat(Math.max(2, localPart.length - 2))}`;
  const maskedDomain =
    domainName.length <= 2
      ? `${domainName.slice(0, 1)}*`
      : `${domainName.slice(0, 2)}${"*".repeat(Math.max(2, domainName.length - 2))}`;

  return `${maskedLocal}@${maskedDomain}${domainSuffix.length ? `.${domainSuffix.join(".")}` : ""}`;
}

function getActionErrorMessage(caughtError: unknown, fallback: string) {
  if (caughtError instanceof Error) {
    if (isSessionLockError(caughtError)) {
      return "Sessao em sincronizacao. Tente novamente em instantes.";
    }

    return caughtError.message || fallback;
  }

  return fallback;
}

export default function FeedPage() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [currentAccount, setCurrentAccount] = useState<AccountRow | null>(null);
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [postLikes, setPostLikes] = useState<Record<string, { count: number; liked: boolean }>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [accountPool, setAccountPool] = useState<AccountRow[]>([]);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [blockedByIds, setBlockedByIds] = useState<string[]>([]);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("for_you");
  const [text, setText] = useState("");
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [pendingLikePostId, setPendingLikePostId] = useState<string | null>(null);
  const [replySubmittingPostId, setReplySubmittingPostId] = useState<string | null>(null);
  const [isEmailVisible, setIsEmailVisible] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");

  async function ensureLoggedUser(options?: { redirectOnMissing?: boolean }) {
    if (user) {
      return user;
    }

    const supabase = getSupabaseBrowserClient();
    const { user: sessionUser, error: sessionError } = await getSessionUserWithRetry(supabase);
    if (!sessionUser) {
      if (sessionError) {
        setError(getActionErrorMessage(sessionError, "Falha ao validar sessao."));
      } else {
        setError("Sua sessao ainda nao foi confirmada. Tente novamente em instantes.");
      }

      if ((options?.redirectOnMissing ?? true) && !isSessionLockError(sessionError)) {
        router.replace("/auth");
      }
      return null;
    }

    setUser(sessionUser);
    return sessionUser;
  }

  async function ensureCurrentAccount(activeUser: User) {
    if (currentAccount?.user_id === activeUser.id) return currentAccount;

    const supabase = getSupabaseBrowserClient();
    const ensuredAccount = await ensureAccountExists(supabase, getSeedFromUser(activeUser));
    setCurrentAccount(ensuredAccount);
    return ensuredAccount;
  }

  async function ensureInteractionContext() {
    const activeUser = await ensureLoggedUser({ redirectOnMissing: false });
    if (!activeUser) return null;

    const activeAccount = await ensureCurrentAccount(activeUser);
    return { activeUser, activeAccount };
  }

  async function refreshState(currentUserArg?: User, currentAccountArg?: AccountRow) {
    const supabase = getSupabaseBrowserClient();
    const activeUser = currentUserArg ?? user;
    const activeAccount = currentAccountArg ?? currentAccount;
    if (!activeUser || !activeAccount) return;

    const [postsRes, followsRes, blocksRes, blockedByRes, accountsRes] = await Promise.all([
      supabase
        .from("posts")
        .select("id, user_id, parent_post_id, content, media_url, media_type, created_at")
        .order("created_at", { ascending: false })
        .limit(120),
      supabase
        .from("follows")
        .select("following_user_id")
        .eq("follower_user_id", activeAccount.user_id),
      supabase
        .from("blocks")
        .select("blocked_user_id")
        .eq("blocker_user_id", activeAccount.user_id),
      supabase
        .from("blocks")
        .select("blocker_user_id")
        .eq("blocked_user_id", activeAccount.user_id),
      supabase
        .from("accounts")
        .select(
          "user_id, name, handle, youtube_account, profile_photo_url, theme_preference, notifications_enabled, email_verified_optional, email_verified_at, is_moderator"
        )
        .limit(100)
    ]);

    if (postsRes.error) throw new Error(postsRes.error.message);
    if (followsRes.error) throw new Error(followsRes.error.message);
    if (blocksRes.error) throw new Error(blocksRes.error.message);
    if (blockedByRes.error) throw new Error(blockedByRes.error.message);
    if (accountsRes.error) throw new Error(accountsRes.error.message);

    const loadedAccounts = (accountsRes.data as AccountRow[]) ?? [];
    const accountsByUserId = new Map(loadedAccounts.map((account) => [account.user_id, account]));
    const loadedPosts = ((postsRes.data as PostQueryRow[]) ?? []).map((post) => ({
      ...post,
      accounts: accountsByUserId.get(post.user_id) ?? null
    }));

    setPosts(loadedPosts);
    setFollowingIds((followsRes.data || []).map((item) => item.following_user_id));
    setBlockedIds((blocksRes.data || []).map((item) => item.blocked_user_id));
    setBlockedByIds((blockedByRes.data || []).map((item) => item.blocker_user_id));
    setAccountPool(loadedAccounts);

    const topLevelIds = loadedPosts.filter((post) => !post.parent_post_id).map((post) => post.id);
    loadPostLikes(topLevelIds, activeAccount.user_id).catch((likeError) => {
      console.warn(
        "Falha ao carregar curtidas:",
        likeError instanceof Error ? likeError.message : likeError
      );
    });
  }

  async function loadPostLikes(postIds: string[], currentUserId: string) {
    if (postIds.length === 0) {
      setPostLikes({});
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("post_likes")
      .select("post_id, user_id")
      .in("post_id", postIds);

    if (error) {
      console.warn("Falha ao carregar curtidas", error.message);
      return;
    }

    const counts: Record<string, { count: number; liked: boolean }> = {};
    for (const row of (data || []) as Array<{ post_id: string; user_id: string }>) {
      const existing = counts[row.post_id] ?? { count: 0, liked: false };
      existing.count += 1;
      if (row.user_id === currentUserId) existing.liked = true;
      counts[row.post_id] = existing;
    }

    setPostLikes(counts);
  }

  async function toggleLike(post: PostRecord) {
    if (pendingLikePostId === post.id) return;

    try {
      setError("");
      setStatus("");
      setPendingLikePostId(post.id);

      const interactionContext = await ensureInteractionContext();
      if (!interactionContext) {
        return;
      }

      const { activeAccount } = interactionContext;
      const supabase = getSupabaseBrowserClient();
      const currentLikes = postLikes[post.id] ?? { count: 0, liked: false };
      const optimisticLikes = {
        count: currentLikes.liked ? Math.max(0, currentLikes.count - 1) : currentLikes.count + 1,
        liked: !currentLikes.liked
      };

      setPostLikes((prev) => ({
        ...prev,
        [post.id]: optimisticLikes
      }));

      try {
        if (currentLikes.liked) {
          const { error } = await supabase
            .from("post_likes")
            .delete()
            .match({ post_id: post.id, user_id: activeAccount.user_id });
          if (error) throw error;
        } else {
          const { error } = await supabase.from("post_likes").insert({
            post_id: post.id,
            user_id: activeAccount.user_id
          });
          if (error) throw error;

          if (post.user_id !== activeAccount.user_id) {
            await supabase.from("notifications").insert({
              recipient_user_id: post.user_id,
              actor_user_id: activeAccount.user_id,
              type: "like",
              post_id: post.id
            });
          }
        }

        setStatus(currentLikes.liked ? "Curtida removida." : "Post curtido.");
      } catch (caughtError) {
        setPostLikes((prev) => ({
          ...prev,
          [post.id]: currentLikes
        }));
        throw caughtError;
      }
    } catch (caughtError) {
      setError(getActionErrorMessage(caughtError, "Falha ao processar curtida."));
    } finally {
      setPendingLikePostId((currentId) => (currentId === post.id ? null : currentId));
    }
  }

  async function submitReply(post: PostRecord, replyText: string) {
    const cleanText = replyText.trim();
    if (!cleanText) return false;
    if (replySubmittingPostId === post.id) return false;

    try {
      setError("");
      setStatus("");
      setReplySubmittingPostId(post.id);

      const interactionContext = await ensureInteractionContext();
      if (!interactionContext) {
        return false;
      }

      const { activeAccount } = interactionContext;
      const supabase = getSupabaseBrowserClient();
      const { data: insertedReply, error: insertError } = await supabase
        .from("posts")
        .insert({
          user_id: activeAccount.user_id,
          parent_post_id: post.id,
          content: cleanText
        })
        .select("id, user_id, parent_post_id, content, media_url, media_type, created_at")
        .single();
      if (insertError) throw insertError;

      if (post.user_id !== activeAccount.user_id) {
        await supabase.from("notifications").insert({
          recipient_user_id: post.user_id,
          actor_user_id: activeAccount.user_id,
          type: "reply",
          post_id: post.id
        });
      }

      if (insertedReply) {
        const optimisticReply: PostRecord = {
          ...(insertedReply as PostQueryRow),
          accounts: activeAccount
        };
        setPosts((currentPosts) => [
          optimisticReply,
          ...currentPosts.filter((item) => item.id !== optimisticReply.id)
        ]);
      }
      const replyTarget = getAccountFromPost(post)?.handle || "anon";
      setStatus(`Comentario publicado para @${replyTarget}.`);
      return true;
    } catch (caughtError) {
      setError(getActionErrorMessage(caughtError, "Falha ao enviar resposta."));
      return false;
    } finally {
      setReplySubmittingPostId((currentId) => (currentId === post.id ? null : currentId));
    }
  }

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    setIsLoading(true);
    ensureLoggedUser()
      .then(async (currentUser) => {
        if (!active || !currentUser) return;

        setUser(currentUser);
        const ensuredAccount = await ensureAccountExists(supabase, getSeedFromUser(currentUser));
        if (!active) return;
        setCurrentAccount(ensuredAccount);
        await refreshState(currentUser, ensuredAccount);
      })
      .catch((caughtError) => {
        if (!active) return;
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Falha ao carregar timeline.";
        setError(messageText);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        if (event === "SIGNED_OUT") {
          router.replace("/auth");
          return;
        }

        if (!session?.user) {
          return;
        }

        setUser(session.user);
        const ensuredAccount = await ensureAccountExists(supabase, getSeedFromUser(session.user));
        setCurrentAccount(ensuredAccount);
        if (event !== "TOKEN_REFRESHED") {
          await refreshState(session.user, ensuredAccount);
        }
      } catch (caughtError) {
        const messageText =
          caughtError instanceof Error
            ? caughtError.message
            : "Falha ao sincronizar sessao atual.";
        setError(messageText);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!file) {
      setFilePreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (text.trim() || file) {
      setIsComposerOpen(true);
    }
  }, [text, file]);

  useEffect(() => {
    if (isComposerOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isComposerOpen]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "0px";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
  }, [text]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOrigin(window.location.origin);
  }, []);

  const followingSet = useMemo(() => new Set(followingIds), [followingIds]);
  const blockedSet = useMemo(() => new Set(blockedIds), [blockedIds]);
  const blockedBySet = useMemo(() => new Set(blockedByIds), [blockedByIds]);

  const visiblePosts = useMemo(() => {
    return posts.filter((post) => !blockedSet.has(post.user_id) && !blockedBySet.has(post.user_id));
  }, [posts, blockedSet, blockedBySet]);

  const timelinePosts = useMemo(() => {
    if (!currentAccount) return [];
    const allPosts = visiblePosts;
    const base =
      timelineMode === "following"
        ? allPosts.filter(
            (post) => post.user_id === currentAccount.user_id || followingSet.has(post.user_id)
          )
        : allPosts;
    return base.filter((post) => !post.parent_post_id);
  }, [visiblePosts, timelineMode, currentAccount, followingSet]);

  const repliesByParent = useMemo(() => {
    const map: Record<string, PostRecord[]> = {};
    for (const post of visiblePosts) {
      if (!post.parent_post_id) continue;
      map[post.parent_post_id] = [...(map[post.parent_post_id] || []), post];
    }
    return map;
  }, [visiblePosts]);

  const suggestedAccounts = useMemo(() => {
    if (!currentAccount) return [];
    return accountPool
      .filter((account) => account.user_id !== currentAccount.user_id)
      .filter((account) => !followingSet.has(account.user_id))
      .filter((account) => !blockedSet.has(account.user_id) && !blockedBySet.has(account.user_id))
      .slice(0, 7);
  }, [accountPool, currentAccount, followingSet, blockedSet, blockedBySet]);

  const recommendedPosts = useMemo(() => {
    if (!currentAccount) return [];
    return visiblePosts
      .filter((post) => post.user_id !== currentAccount.user_id && !followingSet.has(post.user_id))
      .slice(0, 5);
  }, [visiblePosts, followingSet, currentAccount]);

  const displayedEmail = user?.email
    ? isEmailVisible
      ? user.email
      : maskEmail(user.email)
    : "sem email";

  function getPostUrl(postId: string) {
    return origin ? `${origin}/post/${postId}` : `/post/${postId}`;
  }

  function openPostInNewTab(postId: string) {
    const url = getPostUrl(postId);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handlePostCardClick(event: MouseEvent<HTMLElement>, postId: string) {
    const target = event.target as HTMLElement | null;
    if (!target) {
      openPostInNewTab(postId);
      return;
    }
    if (target.closest("button, a, video, img, input, textarea, select, label")) {
      return;
    }
    openPostInNewTab(postId);
  }

  async function copyPostLink(postId: string) {
    const url = getPostUrl(postId);
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

  async function handleMediaUpload(activeUser: User) {
    if (!file) return { mediaUrl: null as string | null, mediaType: null as MediaType };
    const mediaType = getMediaType(file);
    if (!mediaType) throw new Error("Formato de midia nao suportado.");

    const supabase = getSupabaseBrowserClient();
    const extension = file.name.split(".").pop() || "bin";
    const filePath = `${activeUser.id}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("post-media")
      .upload(filePath, file, { upsert: false });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("post-media").getPublicUrl(filePath);
    return { mediaUrl: data.publicUrl, mediaType };
  }

  const publishPost: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (isPublishing) return;

    setError("");
    setStatus("");

    const activeUser = await ensureLoggedUser({ redirectOnMissing: false });
    if (!activeUser) return;

    let activeAccount: AccountRow;
    try {
      activeAccount = await ensureCurrentAccount(activeUser);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Nao foi possivel validar sua conta.";
      setError(messageText);
      return;
    }

    const cleanText = text.trim();
    if (!cleanText && !file) {
      setError("Escreva algo ou envie midia.");
      return;
    }

    setIsPublishing(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { mediaUrl, mediaType } = await handleMediaUpload(activeUser);

      const { data: insertedPostRow, error: insertError } = await supabase
        .from("posts")
        .insert({
          user_id: activeAccount.user_id,
          content: cleanText || null,
          media_url: mediaUrl,
          media_type: mediaType
        })
        .select("id, user_id, parent_post_id, content, media_url, media_type, created_at")
        .single();
      if (insertError) throw insertError;

      setText("");
      clearSelectedFile();
      if (insertedPostRow) {
        const optimisticPost: PostRecord = {
          ...(insertedPostRow as PostQueryRow),
          accounts: activeAccount
        };

        setPosts((currentPosts) => [optimisticPost, ...currentPosts.filter((post) => post.id !== optimisticPost.id)]);
        setPostLikes((currentLikes) => ({
          ...currentLikes,
          [optimisticPost.id]: currentLikes[optimisticPost.id] ?? { count: 0, liked: false }
        }));
      }
      setStatus("Post publicado.");
      setIsComposerOpen(false);
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Erro ao publicar.";
      setError(messageText);
    } finally {
      setIsPublishing(false);
    }
  };

  const onFileChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    setFile(event.target.files?.[0] ?? null);
  };

  function clearSelectedFile() {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function deletePost(postId: string) {
    if (!currentAccount) return;
    setError("");
    setStatus("");
    setIsActionLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: deleteError } = await supabase.from("posts").delete().eq("id", postId);
      if (deleteError) throw deleteError;
      setStatus("Post removido.");
      setPosts((currentPosts) => {
        const removeIds = new Set<string>([postId]);
        for (const post of currentPosts) {
          if (post.parent_post_id === postId) {
            removeIds.add(post.id);
          }
        }
        setPostLikes((currentLikes) => {
          const nextLikes = { ...currentLikes };
          for (const id of removeIds) {
            delete nextLikes[id];
          }
          return nextLikes;
        });
        return currentPosts.filter((post) => !removeIds.has(post.id));
      });
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Nao foi possivel remover o post.";
      setError(messageText);
    } finally {
      setIsActionLoading(false);
    }
  }

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/auth");
  }

  async function lockApp() {
    const supabase = getSupabaseBrowserClient();
    await fetch("/api/access", { method: "DELETE" });
    await supabase.auth.signOut();
    router.replace("/acesso");
  }

  if (isLoading) {
    return (
      <main className="tw-page-shell">
        <section className="tw-card">
          <h1 className="tw-section-title">Twittlier</h1>
          <p>Carregando timeline...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="tw-page-shell">
      <div className="tw-layout-grid">
        <aside className="tw-left-column">
          <section className="tw-card tw-sticky">
            <h1 className="tw-brand">Twittlier</h1>
            <div className="tw-profile-shortcut">
              <button
                className="tw-avatar-button"
                type="button"
                onClick={() => currentAccount?.handle && router.push(`/perfil/${currentAccount.handle}`)}
                disabled={!currentAccount?.handle}
                aria-label="Abrir perfil"
              >
                {currentAccount?.profile_photo_url ? (
                  <img
                    className="tw-avatar"
                    src={currentAccount.profile_photo_url}
                    alt={`Foto de ${currentAccount.name}`}
                  />
                ) : (
                  <div className="tw-avatar fallback">
                    {(currentAccount?.name || "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
              </button>
              <div className="tw-profile-shortcut-meta">
                <button
                  className="tw-profile-link"
                  type="button"
                  onClick={() => currentAccount?.handle && router.push(`/perfil/${currentAccount.handle}`)}
                  disabled={!currentAccount?.handle}
                >
                  {currentAccount?.name || "Usuario"}
                </button>
                <button
                  className="tw-handle-link"
                  type="button"
                  onClick={() => currentAccount?.handle && router.push(`/perfil/${currentAccount.handle}`)}
                  disabled={!currentAccount?.handle}
                >
                  @{currentAccount?.handle || "usuario"}
                </button>
              </div>
            </div>
            <div className="tw-menu tw-menu-compact">
              <button
                className="retro-button tw-menu-button tw-icon-button"
                type="button"
                onClick={() => router.push("/")}
                aria-label="Home"
                title="Home"
              >
                <span className="tw-button-icon">
                  <HomeIcon />
                </span>
                <span className="tw-sr-only">Home</span>
              </button>
              <button
                className="retro-button tw-menu-button tw-icon-button"
                type="button"
                onClick={() => router.push("/live")}
                aria-label="Live"
                title="Live"
              >
                <span className="tw-button-icon">
                  <LiveIcon />
                </span>
                <span className="tw-sr-only">Live</span>
              </button>
              <button
                className="retro-button tw-menu-button tw-icon-button"
                type="button"
                onClick={() => router.push("/configuracoes")}
                aria-label="Configuracoes"
                title="Configuracoes"
              >
                <span className="tw-button-icon">
                  <SettingsIcon />
                </span>
                <span className="tw-sr-only">Configuracoes</span>
              </button>
              <button
                className="retro-button tw-menu-button tw-icon-button"
                type="button"
                onClick={signOut}
                aria-label="Sair"
                title="Sair"
              >
                <span className="tw-button-icon">
                  <LogoutIcon />
                </span>
                <span className="tw-sr-only">Sair</span>
              </button>
              <button
                className="retro-button danger tw-menu-button tw-icon-button"
                type="button"
                onClick={lockApp}
                aria-label="Travar"
                title="Travar"
              >
                <span className="tw-button-icon">
                  <LockIcon />
                </span>
                <span className="tw-sr-only">Travar</span>
              </button>
            </div>
            <div className="tw-user-email-panel">
              <p className="retro-muted">Email da conta</p>
              <div className="tw-user-email-row">
                <span className="tw-sensitive-value" data-visible={isEmailVisible ? "true" : "false"}>
                  {displayedEmail}
                </span>
                {user?.email ? (
                  <button
                    className="retro-button tw-small-button tw-email-toggle"
                    type="button"
                    aria-pressed={isEmailVisible}
                    aria-label={isEmailVisible ? "Ocultar email" : "Mostrar email"}
                    onClick={() => setIsEmailVisible((current) => !current)}
                  >
                    <span className="tw-button-icon">
                      {isEmailVisible ? <EyeOffIcon /> : <EyeIcon />}
                    </span>
                    <span>{isEmailVisible ? "Ocultar" : "Mostrar"}</span>
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        </aside>

        <section className="tw-main-column">
          <section className="tw-card tw-composer-card" data-open={isComposerOpen ? "true" : "false"}>
            <div className="tw-composer-head">
              <h2 className="tw-section-title">Publicar</h2>
              <button
                className="retro-button tw-icon-button tw-composer-toggle"
                type="button"
                aria-label={isComposerOpen ? "Fechar publicacao" : "Abrir publicacao"}
                data-open={isComposerOpen ? "true" : "false"}
                onClick={() => setIsComposerOpen((current) => !current)}
              >
                <span className="tw-button-icon">
                  <PlusIcon />
                </span>
              </button>
            </div>
            {isComposerOpen ? (
              <form className="retro-form" onSubmit={publishPost}>
                <textarea
                  ref={textareaRef}
                  className="tw-composer-input"
                  placeholder="O que esta acontecendo?"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
                <div className="tw-composer-toolbar">
                  <input
                    id="composer-media"
                    ref={fileInputRef}
                    className="tw-file-input-hidden"
                    type="file"
                    accept="image/*,video/*,.gif"
                    onChange={onFileChange}
                  />
                  <label
                    htmlFor="composer-media"
                    className="tw-upload-box"
                    data-has-file={file ? "true" : "false"}
                  >
                    <span className="tw-upload-title">
                      {file ? "Midia selecionada" : "Adicionar foto, video ou gif"}
                    </span>
                    <span className="tw-upload-meta">
                      {file
                        ? `${file.name} (${formatBytes(file.size)})`
                        : "Clique para escolher uma midia"}
                    </span>
                  </label>
                  {file ? (
                    <button
                      className="retro-button tw-small-button"
                      type="button"
                      onClick={clearSelectedFile}
                    >
                      Remover
                    </button>
                  ) : null}
                  <span className="retro-muted tw-char-counter">{text.length}/280</span>
                </div>
                <div className="tw-composer-progress">
                  <input
                    className="tw-composer-range"
                    type="range"
                    min={1}
                    max={280}
                    value={Math.max(1, text.length)}
                    readOnly
                  />
                </div>
                {filePreviewUrl ? (
                  file?.type.startsWith("video/") ? (
                    <video className="tw-composer-preview" src={filePreviewUrl} controls />
                  ) : (
                    <img className="tw-composer-preview" src={filePreviewUrl} alt="Previa da midia" />
                  )
                ) : null}
                <button className="retro-button primary tw-publish-button" type="submit" disabled={isPublishing}>
                  {isPublishing ? "Publicando..." : "Postar"}
                </button>
              </form>
            ) : (
              <p className="retro-muted">Clique no + para criar um post.</p>
            )}
            {status ? <p className="retro-muted">{status}</p> : null}
            {error ? <p className="retro-error">{error}</p> : null}
          </section>

          <section className="tw-card">
            <div className="tw-feed-tabs">
              <button
                className="retro-button"
                data-active={timelineMode === "for_you"}
                type="button"
                onClick={() => setTimelineMode("for_you")}
              >
                Para voce
              </button>
              <button
                className="retro-button"
                data-active={timelineMode === "following"}
                type="button"
                onClick={() => setTimelineMode("following")}
              >
                Seguindo
              </button>
            </div>

            <div className="tw-feed-list">
              {timelinePosts.length === 0 ? (
                <p className="retro-muted">Sem posts para mostrar.</p>
              ) : (
                timelinePosts.map((post) => {
                  const author = getAccountFromPost(post);
                  const isOwnPost = currentAccount?.user_id === post.user_id;
                  const likeInfo = postLikes[post.id] ?? { count: 0, liked: false };
                  const replyCount = repliesByParent[post.id]?.length ?? 0;
                  const replyDraft = replyDrafts[post.id] ?? "";
                  const isReplying = Object.prototype.hasOwnProperty.call(replyDrafts, post.id);
                  const isLikePending = pendingLikePostId === post.id;
                  const isReplySubmitting = replySubmittingPostId === post.id;
                  const canDelete = Boolean(isOwnPost || currentAccount?.is_moderator);

                  return (
                    <div key={post.id}>
                      <article
                        className="tw-post-card"
                        aria-busy={isLikePending || isReplySubmitting}
                        role="link"
                        tabIndex={0}
                        onClick={(event) => handlePostCardClick(event, post.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openPostInNewTab(post.id);
                          }
                        }}
                      >
                         <div className="tw-post-header">
                           <button
                            className="tw-author-link"
                            type="button"
                            disabled={!author?.handle}
                            onClick={() => author?.handle && router.push(`/perfil/${author.handle}`)}
                            aria-label={author?.handle ? `Abrir perfil de ${author.handle}` : "Perfil indisponivel"}
                          >
                             {author?.profile_photo_url ? (
                               <img className="tw-avatar" src={author.profile_photo_url} alt={`Foto de ${author.name}`} />
                             ) : (
                              <div className="tw-avatar fallback">
                                {(author?.name || "?").slice(0, 1).toUpperCase()}
                              </div>
                            )}
                            <span>
                              <span className="tw-post-name">
                                {author?.name || "Anon"}
                                {author?.is_moderator ? <span className="tw-role-chip">MOD</span> : null}
                              </span>
                              <span className="tw-post-handle">@{author?.handle || "anon"}</span>
                            </span>
                          </button>
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

                         {(likeInfo.count > 0 || replyCount > 0) ? (
                           <div className="tw-post-engagement" aria-label="Resumo de interacoes">
                             <span className="tw-meta-chip">{likeInfo.count} curtidas</span>
                             <span className="tw-meta-chip">{replyCount} comentarios</span>
                           </div>
                         ) : null}

                       <div className="tw-post-actions">
                         <button
                          className="retro-button tw-icon-button"
                          type="button"
                          onClick={() => copyPostLink(post.id)}
                          aria-label="Copiar link do post"
                          title="Copiar link"
                         >
                          <span className="tw-button-icon">
                            <ShareIcon />
                          </span>
                         </button>
                         {currentAccount ? (
                           <>
                             <button
                               className="retro-button tw-icon-button tw-action-button"
                               data-active={likeInfo.liked ? "true" : "false"}
                               data-kind="like"
                               type="button"
                               aria-pressed={likeInfo.liked}
                               aria-label={likeInfo.liked ? "Remover curtida" : "Curtir post"}
                               title={likeInfo.liked ? "Curtido" : "Curtir"}
                               disabled={isLikePending}
                               onClick={() => toggleLike(post)}
                             >
                               <span className="tw-button-icon">
                                 <HeartIcon filled={likeInfo.liked} />
                               </span>
                             </button>
                             <button
                               className="retro-button tw-icon-button tw-action-button"
                               data-active={isReplying ? "true" : "false"}
                               data-kind="reply"
                               type="button"
                               aria-expanded={isReplying}
                               aria-label={isReplying ? "Fechar comentarios" : "Comentar no post"}
                               title={isReplying ? "Fechar comentarios" : "Comentar"}
                               onClick={() =>
                                 setReplyDrafts((prev) => {
                                   const next = { ...prev };
                                   if (isReplying) {
                                    delete next[post.id];
                                  } else {
                                    next[post.id] = "";
                                  }
                                   return next;
                                 })
                               }
                             >
                               <span className="tw-button-icon">
                                 <CommentIcon />
                               </span>
                             </button>
                           </>
                         ) : null}
                          {canDelete ? (
                            <button
                              className="retro-button danger tw-icon-button"
                              type="button"
                              disabled={isActionLoading}
                              onClick={() => deletePost(post.id)}
                              aria-label="Remover post"
                              title="Remover"
                            >
                              <span className="tw-button-icon">
                                <TrashIcon />
                              </span>
                            </button>
                          ) : null}
                       </div>
                       {isReplying ? (
                         <form
                           className="retro-form tw-reply-panel"
                           onSubmit={async (event) => {
                             event.preventDefault();
                             const wasSubmitted = await submitReply(post, replyDraft);
                             if (!wasSubmitted) return;
                             setReplyDrafts((prev) => {
                               const next = { ...prev };
                               delete next[post.id];
                               return next;
                             });
                           }}
                         >
                           <div className="tw-reply-context">
                             <span className="tw-reply-badge">Comentario</span>
                             <p className="retro-muted">Respondendo a @{author?.handle || "anon"}</p>
                           </div>
                           <textarea
                             className="tw-composer-input"
                             placeholder="Escreva seu comentario..."
                             value={replyDraft}
                             onChange={(event) =>
                               setReplyDrafts((prev) => ({ ...prev, [post.id]: event.target.value }))
                             }
                           />
                           <button
                             className="retro-button primary tw-small-button"
                             type="submit"
                             disabled={!replyDraft.trim() || isReplySubmitting}
                           >
                             {isReplySubmitting ? "Publicando..." : "Publicar comentario"}
                           </button>
                         </form>
                       ) : null}
                      </article>
                     <div className="tw-post-replies">
                      {repliesByParent[post.id]?.map((reply) => {
                        const replyAuthor = getAccountFromPost(reply);
                        const replyIsOwn = currentAccount?.user_id === reply.user_id;

                        return (
                      <article className="tw-post-card tw-post-reply-card" key={reply.id}>
                           <div className="tw-post-header">
                             <button
                              className="tw-author-link"
                              type="button"
                              disabled={!replyAuthor?.handle}
                              onClick={() => replyAuthor?.handle && router.push(`/perfil/${replyAuthor.handle}`)}
                              aria-label={replyAuthor?.handle ? `Abrir perfil de ${replyAuthor.handle}` : "Perfil indisponivel"}
                            >
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
                              <span>
                                <span className="tw-post-name">
                                  {replyAuthor?.name || "Anon"}
                                  {replyAuthor?.is_moderator ? (
                                    <span className="tw-role-chip">MOD</span>
                                 ) : null}
                               </span>
                               <span className="tw-post-handle">
                                  @{replyAuthor?.handle || "anon"}
                                </span>
                              </span>
                            </button>
                            <div className="tw-inline-actions">
                              <span className="tw-reply-badge">Resposta</span>
                              <time className="post-time">
                                {new Date(reply.created_at).toLocaleString("pt-BR")}
                              </time>
                            </div>
                          </div>
                          {reply.content ? <p className="post-text">{reply.content}</p> : null}
                          {reply.media_url && reply.media_type === "video" ? (
                            <video className="tw-post-media" src={reply.media_url} controls />
                          ) : null}
                          {reply.media_url && reply.media_type !== "video" ? (
                            <img className="tw-post-media" src={reply.media_url} alt="Midia do post" />
                          ) : null}

                          {replyIsOwn ? (
                            <button
                              className="retro-button danger tw-small-button"
                              type="button"
                              disabled={isActionLoading}
                              onClick={() => deletePost(reply.id)}
                            >
                              Remover
                            </button>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
            </div>
          </section>
        </section>

        <aside className="tw-right-column">
          <section className="tw-card tw-sticky">
            <h2 className="tw-section-title">Recomendacoes</h2>
            <h3 className="tw-subtitle">Perfis sugeridos</h3>
            <div className="tw-suggestion-list">
              {suggestedAccounts.length === 0 ? (
                <p className="retro-muted">Sem sugestoes no momento.</p>
              ) : (
                suggestedAccounts.map((item) => (
                  <button
                    className="tw-suggestion-item tw-suggestion-link"
                    key={item.user_id}
                    type="button"
                    onClick={() => router.push(`/perfil/${item.handle}`)}
                  >
                    <strong>@{item.handle}</strong>
                    <span className="retro-muted">{item.name}</span>
                  </button>
                ))
              )}
            </div>

            <h3 className="tw-subtitle">Posts recomendados</h3>
            <div className="tw-recommended-posts">
              {recommendedPosts.length === 0 ? (
                <p className="retro-muted">Sem recomendacoes agora.</p>
              ) : (
                recommendedPosts.map((post) => {
                  const author = getAccountFromPost(post);
                  return (
                    <button
                      className="tw-recommended-item"
                      key={post.id}
                      type="button"
                      onClick={() => router.push(`/post/${post.id}`)}
                    >
                      <strong>@{author?.handle || "anon"}</strong>
                      <span>{(post.content || "Midia").slice(0, 82)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
