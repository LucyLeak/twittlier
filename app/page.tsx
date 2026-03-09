"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type MediaType = "image" | "video" | "gif" | null;

type PostRecord = {
  id: string;
  user_id: string;
  content: string | null;
  media_url: string | null;
  media_type: MediaType;
  created_at: string;
  profiles: { username: string } | { username: string }[] | null;
};

function getProfileName(post: PostRecord) {
  if (!post.profiles) return "anon";
  if (Array.isArray(post.profiles)) return post.profiles[0]?.username ?? "anon";
  return post.profiles.username;
}

function getMediaType(file: File): MediaType {
  if (file.type === "image/gif") return "gif";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  return null;
}

export default function FeedPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadPosts() {
    const supabase = getSupabaseBrowserClient();
    const { data, error: selectError } = await supabase
      .from("posts")
      .select("id, user_id, content, media_url, media_type, created_at, profiles(username)")
      .order("created_at", { ascending: false })
      .limit(100);

    if (selectError) {
      setError(selectError.message);
      return;
    }

    setPosts((data as PostRecord[]) ?? []);
  }

  async function ensureLogged() {
    const supabase = getSupabaseBrowserClient();
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !data.session?.user) {
      router.replace("/auth");
      return null;
    }

    return data.session.user;
  }

  useEffect(() => {
    let active = true;
    const supabase = getSupabaseBrowserClient();

    ensureLogged()
      .then(async (currentUser) => {
        if (!active || !currentUser) return;
        setUser(currentUser);
        await loadPosts();
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/auth");
        return;
      }
      setUser(session.user);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  async function handleMediaUpload(currentUser: User) {
    if (!file) return { mediaUrl: null as string | null, mediaType: null as MediaType };
    const supabase = getSupabaseBrowserClient();

    const mediaType = getMediaType(file);
    if (!mediaType) {
      throw new Error("Formato de midia nao suportado.");
    }

    const extension = file.name.split(".").pop() || "bin";
    const filePath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("post-media")
      .upload(filePath, file, { upsert: false });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("post-media").getPublicUrl(filePath);
    return { mediaUrl: data.publicUrl, mediaType };
  }

  async function onPublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");

    const currentUser = await ensureLogged();
    if (!currentUser) return;

    const cleanText = text.trim();
    if (!cleanText && !file) {
      setError("Escreva algo ou envie midia.");
      return;
    }

    setIsPublishing(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { mediaUrl, mediaType } = await handleMediaUpload(currentUser);
      const { error: insertError } = await supabase.from("posts").insert({
        user_id: currentUser.id,
        content: cleanText || null,
        media_url: mediaUrl,
        media_type: mediaType
      });

      if (insertError) throw insertError;

      setText("");
      setFile(null);
      setStatus("Post publicado.");
      await loadPosts();
    } catch (caughtError) {
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Erro ao publicar.";
      setError(messageText);
    } finally {
      setIsPublishing(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
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
      <main className="retro-page">
        <section className="retro-window">
          <h1 className="retro-title">Twittlier :: carregando</h1>
          <p>Validando sessao...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="retro-page">
      <section className="retro-window">
        <h1 className="retro-title">Twittlier :: feed privado</h1>
        <div className="retro-row">
          <span className="retro-muted">Logado como: {user?.email}</span>
          <button className="retro-button" type="button" onClick={signOut}>
            Sair da conta
          </button>
          <button className="retro-button danger" type="button" onClick={lockApp}>
            Travar acesso
          </button>
        </div>
      </section>

      <section className="retro-window">
        <h2 className="retro-title">Novo post</h2>
        <form className="retro-form" onSubmit={onPublish}>
          <textarea
            className="retro-textarea"
            placeholder="O que voce quer publicar hoje?"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <input
            className="retro-file"
            type="file"
            accept="image/*,video/*,.gif"
            onChange={onFileChange}
          />
          <p className="retro-muted">Aceita texto, foto, video e gif.</p>
          {status ? <p className="retro-muted">{status}</p> : null}
          {error ? <p className="retro-error">{error}</p> : null}
          <button className="retro-button primary" disabled={isPublishing} type="submit">
            {isPublishing ? "Publicando..." : "Publicar"}
          </button>
        </form>
      </section>

      <section className="retro-window">
        <h2 className="retro-title">Timeline</h2>
        <div className="feed-list">
          {posts.length === 0 ? (
            <p className="retro-muted">Sem posts ainda. Crie o primeiro.</p>
          ) : (
            posts.map((post) => (
              <article className="post-card" key={post.id}>
                <div className="post-head">
                  <span className="post-user">@{getProfileName(post)}</span>
                  <time className="post-time">
                    {new Date(post.created_at).toLocaleString("pt-BR")}
                  </time>
                </div>
                {post.content ? <p className="post-text">{post.content}</p> : null}
                {post.media_url && post.media_type === "video" ? (
                  <video className="post-media" src={post.media_url} controls />
                ) : null}
                {post.media_url && post.media_type !== "video" ? (
                  <img className="post-media" src={post.media_url} alt="Midia do post" />
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
