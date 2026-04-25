"use client";

import { useEffect, useRef, useState } from "react";
import {
  STAGE_OVERLAY_POLL_MS,
  STAGE_SOUND_NOTICE_MS,
  type StageAssetType
} from "@/lib/live-stage";
import styles from "./page.module.css";

type OverlayEvent = {
  id: string;
  asset_id: string;
  asset_name: string;
  asset_command: string;
  media_url: string;
  media_type: StageAssetType;
  image_duration_seconds: number | null;
  triggered_by_handle: string;
  created_at: string;
};

const SOUND_FALLBACK_TIMEOUT_MS = 30_000;
const VIDEO_FALLBACK_TIMEOUT_MS = 180_000;

export default function LiveStageOverlayPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<OverlayEvent[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const currentEventRef = useRef<OverlayEvent | null>(null);
  const processingRef = useRef(false);
  const completionTimeoutRef = useRef<number | null>(null);
  const noticeTimeoutRef = useRef<number | null>(null);

  const [streamHandle, setStreamHandle] = useState("");
  const [overlayKey, setOverlayKey] = useState("");
  const [roomHandle, setRoomHandle] = useState("");
  const [activeVisualEvent, setActiveVisualEvent] = useState<OverlayEvent | null>(null);
  const [soundNoticeEvent, setSoundNoticeEvent] = useState<OverlayEvent | null>(null);
  const [error, setError] = useState("");

  function clearTimers() {
    if (completionTimeoutRef.current) {
      window.clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = null;
    }
  }

  function finishCurrentEvent() {
    clearTimers();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    processingRef.current = false;
    currentEventRef.current = null;
    setActiveVisualEvent(null);
    setSoundNoticeEvent(null);
    processNextEvent();
  }

  function processNextEvent() {
    if (processingRef.current) return;
    const nextEvent = queueRef.current.shift();
    if (!nextEvent) return;

    processingRef.current = true;
    currentEventRef.current = nextEvent;
    setError("");

    if (nextEvent.media_type === "sound") {
      setActiveVisualEvent(null);
      setSoundNoticeEvent(nextEvent);

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = nextEvent.media_url;
        audioRef.current.load();
        void audioRef.current.play().catch(() => {
          setError("OBS bloqueou o autoplay do audio. Ative audio automatico no Browser Source.");
        });
      }

      noticeTimeoutRef.current = window.setTimeout(() => {
        setSoundNoticeEvent((current) => (current?.id === nextEvent.id ? null : current));
      }, STAGE_SOUND_NOTICE_MS);

      completionTimeoutRef.current = window.setTimeout(() => {
        finishCurrentEvent();
      }, SOUND_FALLBACK_TIMEOUT_MS);
      return;
    }

    setSoundNoticeEvent(null);
    setActiveVisualEvent(nextEvent);

    if (nextEvent.media_type === "image") {
      const durationMs = (nextEvent.image_duration_seconds || 8) * 1000;
      completionTimeoutRef.current = window.setTimeout(() => {
        finishCurrentEvent();
      }, durationMs);
      return;
    }

    completionTimeoutRef.current = window.setTimeout(() => {
      finishCurrentEvent();
    }, VIDEO_FALLBACK_TIMEOUT_MS);
  }

  async function loadOverlayFeed(targetStream: string, targetKey: string) {
    const response = await fetch(
      `/api/live-stage-feed?stream=${encodeURIComponent(targetStream)}&key=${encodeURIComponent(targetKey)}`,
      { cache: "no-store" }
    );

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          roomOwner?: { handle?: string | null };
          events?: OverlayEvent[];
        }
      | null;

    if (!response.ok) {
      throw new Error(payload?.error || "Falha ao atualizar o overlay do palco.");
    }

    setRoomHandle(payload?.roomOwner?.handle || "");
    const overlayEvents = payload?.events ?? [];
    const seenIds = seenIdsRef.current;

    if (!initializedRef.current) {
      for (const eventItem of overlayEvents) {
        seenIds.add(eventItem.id);
      }
      initializedRef.current = true;
      return;
    }

    const newEvents = overlayEvents.filter((eventItem) => !seenIds.has(eventItem.id));
    if (newEvents.length === 0) return;

    for (const eventItem of newEvents) {
      seenIds.add(eventItem.id);
      queueRef.current.push(eventItem);
    }

    if (seenIds.size > 400) {
      seenIdsRef.current = new Set(overlayEvents.map((eventItem) => eventItem.id));
    }

    processNextEvent();
  }

  useEffect(() => {
    document.documentElement.classList.add("tw-stage-overlay-html");
    document.body.classList.add("tw-stage-overlay-body");

    const params = new URLSearchParams(window.location.search);
    const requestedStream = params.get("stream") || "";
    const requestedKey = params.get("key") || "";

    setStreamHandle(requestedStream);
    setOverlayKey(requestedKey);

    if (!requestedStream || !requestedKey) {
      setError("URL do overlay incompleta. Informe stream e key.");
      return () => {
        document.documentElement.classList.remove("tw-stage-overlay-html");
        document.body.classList.remove("tw-stage-overlay-body");
      };
    }

    let active = true;

    loadOverlayFeed(requestedStream, requestedKey).catch((caughtError) => {
      if (!active) return;
      const messageText =
        caughtError instanceof Error ? caughtError.message : "Falha ao carregar overlay.";
      setError(messageText);
    });

    const interval = window.setInterval(() => {
      loadOverlayFeed(requestedStream, requestedKey).catch((caughtError) => {
        if (!active) return;
        const messageText =
          caughtError instanceof Error ? caughtError.message : "Falha ao atualizar overlay.";
        setError(messageText);
      });
    }, STAGE_OVERLAY_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
      clearTimers();
      document.documentElement.classList.remove("tw-stage-overlay-html");
      document.body.classList.remove("tw-stage-overlay-body");
    };
  }, []);

  useEffect(() => {
    if (activeVisualEvent?.media_type !== "video" || !videoRef.current) return;

    videoRef.current.pause();
    videoRef.current.currentTime = 0;
    videoRef.current.load();
    void videoRef.current.play().catch(() => {
      setError("OBS bloqueou o autoplay do video. Verifique as configuracoes do Browser Source.");
    });
  }, [activeVisualEvent]);

  return (
    <main className={styles.overlayRoot}>
      <audio
        ref={audioRef}
        className={styles.hiddenAudio}
        onEnded={finishCurrentEvent}
        onError={finishCurrentEvent}
      />

      {activeVisualEvent ? (
        <section className={styles.visualLayer}>
          <div className={styles.visualChrome}>
            <div className={styles.visualMeta}>
              <span className={styles.metaPill}>@{roomHandle || streamHandle}</span>
              <span className={styles.metaPill}>{activeVisualEvent.asset_command}</span>
            </div>

            {activeVisualEvent.media_type === "image" ? (
              <img
                className={styles.visualMedia}
                src={activeVisualEvent.media_url}
                alt={activeVisualEvent.asset_name}
              />
            ) : null}

            {activeVisualEvent.media_type === "video" ? (
              <video
                key={activeVisualEvent.id}
                ref={videoRef}
                className={styles.visualMedia}
                src={activeVisualEvent.media_url}
                autoPlay
                playsInline
                onEnded={finishCurrentEvent}
                onError={finishCurrentEvent}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {soundNoticeEvent ? (
        <aside className={styles.soundNotice}>
          <p className={styles.noticeEyebrow}>Som ao vivo</p>
          <p className={styles.noticeText}>
            @{soundNoticeEvent.triggered_by_handle} usou um comando de som:{" "}
            <strong>{soundNoticeEvent.asset_name}</strong>
          </p>
        </aside>
      ) : null}

      {error ? (
        <aside className={styles.errorNotice}>
          <strong>Overlay OBS</strong>
          <span>{error}</span>
        </aside>
      ) : null}
    </main>
  );
}
