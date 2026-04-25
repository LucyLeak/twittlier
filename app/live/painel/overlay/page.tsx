"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import {
  STAGE_OVERLAY_POLL_MS,
  STAGE_SOUND_NOTICE_MS,
  clampStageAudioVolumePercent,
  clampStageDisplayCoordinatePercent,
  clampStageDisplaySizePercent,
  normalizeStageDisplayFit,
  normalizeStageEntryAnimation,
  type StageAssetType,
  type StageDisplayFit,
  type StageEntryAnimation
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
  display_size_percent: number;
  display_x_percent: number;
  display_y_percent: number;
  display_fit: StageDisplayFit;
  entry_animation: StageEntryAnimation;
  audio_volume_percent: number;
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

  const [activeVisualEvent, setActiveVisualEvent] = useState<OverlayEvent | null>(null);
  const [soundNoticeEvent, setSoundNoticeEvent] = useState<OverlayEvent | null>(null);

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

    if (nextEvent.media_type === "sound") {
      setActiveVisualEvent(null);
      setSoundNoticeEvent(nextEvent);

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = nextEvent.media_url;
        audioRef.current.volume =
          clampStageAudioVolumePercent(nextEvent.audio_volume_percent) / 100;
        audioRef.current.load();
        void audioRef.current
          .play()
          .catch((caughtError) =>
            console.warn("Falha ao tocar audio no overlay do OBS:", caughtError)
          );
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

  async function loadOverlayFeed(targetStream: string) {
    const response = await fetch(`/api/live-stage-feed?stream=${encodeURIComponent(targetStream)}`, {
      cache: "no-store"
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          events?: OverlayEvent[];
        }
      | null;

    if (!response.ok) {
      throw new Error(payload?.error || "Falha ao atualizar o overlay do palco.");
    }

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

    if (!requestedStream) {
      console.warn("Overlay sem parametro stream.");
      return () => {
        document.documentElement.classList.remove("tw-stage-overlay-html");
        document.body.classList.remove("tw-stage-overlay-body");
      };
    }

    let active = true;

    loadOverlayFeed(requestedStream).catch((caughtError) => {
      if (!active) return;
      console.warn(
        "Falha ao carregar overlay do palco:",
        caughtError instanceof Error ? caughtError.message : caughtError
      );
    });

    const interval = window.setInterval(() => {
      loadOverlayFeed(requestedStream).catch((caughtError) => {
        if (!active) return;
        console.warn(
          "Falha ao atualizar overlay do palco:",
          caughtError instanceof Error ? caughtError.message : caughtError
        );
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
    void videoRef.current
      .play()
      .catch((caughtError) =>
        console.warn("Falha ao tocar video no overlay do OBS:", caughtError)
      );
  }, [activeVisualEvent]);

  const activeVisualSizePercent = activeVisualEvent
    ? clampStageDisplaySizePercent(activeVisualEvent.display_size_percent)
    : 100;
  const activeVisualXPercent = activeVisualEvent
    ? clampStageDisplayCoordinatePercent(activeVisualEvent.display_x_percent)
    : 50;
  const activeVisualYPercent = activeVisualEvent
    ? clampStageDisplayCoordinatePercent(activeVisualEvent.display_y_percent)
    : 50;
  const activeVisualFit = activeVisualEvent
    ? normalizeStageDisplayFit(activeVisualEvent.display_fit)
    : "contain";
  const activeVisualAnimation = activeVisualEvent
    ? normalizeStageEntryAnimation(activeVisualEvent.entry_animation)
    : "fade";
  const soundNoticeAnimation = soundNoticeEvent
    ? normalizeStageEntryAnimation(soundNoticeEvent.entry_animation)
    : "fade";

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
          <div className={styles.visualMediaLayer}>
            <div
              key={`${activeVisualEvent.id}:${activeVisualAnimation}:${activeVisualSizePercent}:${activeVisualFit}:${activeVisualXPercent}:${activeVisualYPercent}`}
              className={styles.visualFrame}
              data-animation={activeVisualAnimation}
              style={
                {
                  left: `${activeVisualXPercent}%`,
                  top: `${activeVisualYPercent}%`,
                  width: `${activeVisualSizePercent}%`,
                  height: `${activeVisualSizePercent}%`
                } satisfies CSSProperties
              }
            >
              {activeVisualEvent.media_type === "image" ? (
                <img
                  className={styles.visualMedia}
                  data-fit={activeVisualFit}
                  src={activeVisualEvent.media_url}
                  alt={activeVisualEvent.asset_name}
                />
              ) : null}

              {activeVisualEvent.media_type === "video" ? (
                <video
                  key={activeVisualEvent.id}
                  ref={videoRef}
                  className={styles.visualMedia}
                  data-fit={activeVisualFit}
                  src={activeVisualEvent.media_url}
                  autoPlay
                  playsInline
                  onEnded={finishCurrentEvent}
                  onError={finishCurrentEvent}
                />
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {soundNoticeEvent ? (
        <aside className={styles.soundNotice} data-animation={soundNoticeAnimation}>
          <p className={styles.noticeText}>
            @{soundNoticeEvent.triggered_by_handle} usou um comando de som:{" "}
            <strong>{soundNoticeEvent.asset_name}</strong>
          </p>
        </aside>
      ) : null}
    </main>
  );
}
