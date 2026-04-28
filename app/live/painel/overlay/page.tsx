"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import {
  STAGE_OVERLAY_POLL_MS,
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

type OverlayActiveElement = {
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
  z_index: number;
  added_by_handle: string;
  created_at: string;
  expires_at: string | null;
};

type OverlayStateResponse = {
  roomOwner: {
    user_id: string;
    handle: string;
    name: string | null;
  };
  elements: OverlayActiveElement[];
  version: number;
  timestamp: string;
};

type OverlayStateResponse = {
  roomOwner: {
    user_id: string;
    handle: string;
    name: string | null;
  };
  elements: OverlayActiveElement[];
  version: number;
  timestamp: string;
};

const SOUND_FALLBACK_TIMEOUT_MS = 30_000;

export default function LiveStageOverlayPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRefsRef = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const lastVersionRef = useRef(-1);
  const audioTimeoutRef = useRef<number | null>(null);
  const elementTimeoutsRef = useRef<Map<string, number>>(new Map());

  const [elements, setElements] = useState<OverlayActiveElement[]>([]);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  function clearAudioTimeout() {
    if (audioTimeoutRef.current) {
      window.clearTimeout(audioTimeoutRef.current);
      audioTimeoutRef.current = null;
    }
  }

  function stopAudio() {
    clearAudioTimeout();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    setPlayingAudioId(null);
  }

  function playAudioElement(element: OverlayActiveElement) {
    stopAudio();

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = element.media_url;
      audioRef.current.volume =
        clampStageAudioVolumePercent(element.audio_volume_percent) / 100;
      audioRef.current.load();
      setPlayingAudioId(element.id);

      void audioRef.current
        .play()
        .catch((caughtError) =>
          console.warn("Falha ao tocar audio no overlay do OBS:", caughtError)
        );
    }

    // Fallback timeout
    audioTimeoutRef.current = window.setTimeout(() => {
      stopAudio();
    }, SOUND_FALLBACK_TIMEOUT_MS);
  }

  function scheduleElementRemoval(elementId: string, durationMs: number) {
    const timeoutId = window.setTimeout(() => {
      elementTimeoutsRef.current.delete(elementId);
    }, durationMs);

    elementTimeoutsRef.current.set(elementId, timeoutId);
  }

  async function loadOverlayState(targetStream: string) {
    try {
      const response = await fetch(
        `/api/live-overlay-state?stream=${encodeURIComponent(targetStream)}`,
        { cache: "no-store" }
      );

      const payload = (await response.json().catch(() => null)) as OverlayStateResponse | null;

      if (!response.ok) {
        throw new Error(payload?.roomOwner ? "Failed to load state" : "Invalid response");
      }

      if (!payload) throw new Error("No payload");

      // Only update if version changed
      if (payload.version === lastVersionRef.current) {
        return;
      }

      lastVersionRef.current = payload.version;

      // Process elements
      const now = new Date().getTime();
      const validElements = (payload.elements ?? []).filter((el) => {
        if (!el.expires_at) return true;
        return new Date(el.expires_at).getTime() > now;
      });

      setElements(validElements);

      // Schedule audio playback and auto-removal
      for (const element of validElements) {
        if (element.media_type === "sound") {
          playAudioElement(element);
        } else if (element.media_type === "image" && element.image_duration_seconds) {
          const durationMs = element.image_duration_seconds * 1000;
          scheduleElementRemoval(element.id, durationMs);
        }
      }
    } catch (caughtError) {
      console.warn(
        "Falha ao atualizar overlay do palco:",
        caughtError instanceof Error ? caughtError.message : caughtError
      );
    }
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

    // Initial load
    loadOverlayState(requestedStream).catch(() => {
      // Error already logged in function
    });

    // Poll for updates
    const interval = window.setInterval(() => {
      if (active) {
        loadOverlayState(requestedStream).catch(() => {
          // Error already logged in function
        });
      }
    }, STAGE_OVERLAY_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
      clearAudioTimeout();
      elementTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      elementTimeoutsRef.current.clear();
      stopAudio();
      document.documentElement.classList.remove("tw-stage-overlay-html");
      document.body.classList.remove("tw-stage-overlay-body");
    };
  }, []);

  // Handle video playback
  useEffect(() => {
    for (const element of elements) {
      if (element.media_type !== "video") continue;

      const videoRef = videoRefsRef.current.get(element.id);
      if (!videoRef) continue;

      videoRef.pause();
      videoRef.currentTime = 0;
      videoRef.load();
      void videoRef
        .play()
        .catch((caughtError) =>
          console.warn("Falha ao tocar video no overlay do OBS:", caughtError)
        );
    }
  }, [elements]);

  // Sort by z-index
  const sortedElements = [...elements].sort((a, b) => a.z_index - b.z_index);

  return (
    <main className={styles.overlayRoot}>
      <audio
        ref={audioRef}
        className={styles.hiddenAudio}
        onEnded={stopAudio}
        onError={stopAudio}
      />

      <div className={styles.elementsContainer}>
        {sortedElements.map((element) => {
          const sizePercent = clampStageDisplaySizePercent(element.display_size_percent);
          const xPercent = clampStageDisplayCoordinatePercent(element.display_x_percent);
          const yPercent = clampStageDisplayCoordinatePercent(element.display_y_percent);
          const fit = normalizeStageDisplayFit(element.display_fit);
          const animation = normalizeStageEntryAnimation(element.entry_animation);
          const isPlaying = playingAudioId === element.id;

          return element.media_type === "sound" ? (
            // Sound element - show notice
            <aside
              key={element.id}
              className={styles.soundNotice}
              data-animation={animation}
              style={
                {
                  zIndex: element.z_index
                } satisfies CSSProperties
              }
            >
              <p className={styles.noticeText}>
                @{element.added_by_handle} usou {element.asset_command}:{" "}
                <strong>{element.asset_name}</strong>
              </p>
            </aside>
          ) : element.media_type === "image" ? (
            // Image element
            <section
              key={element.id}
              className={styles.visualLayer}
              style={
                {
                  zIndex: element.z_index
                } satisfies CSSProperties
              }
            >
              <div className={styles.visualMediaLayer}>
                <div
                  className={styles.visualFrame}
                  data-animation={animation}
                  style={
                    {
                      left: `${xPercent}%`,
                      top: `${yPercent}%`,
                      width: `${sizePercent}%`,
                      height: `${sizePercent}%`
                    } satisfies CSSProperties
                  }
                >
                  <img
                    className={styles.visualMedia}
                    data-fit={fit}
                    src={element.media_url}
                    alt={element.asset_name}
                  />
                </div>
              </div>
            </section>
          ) : element.media_type === "video" ? (
            // Video element
            <section
              key={element.id}
              className={styles.visualLayer}
              style={
                {
                  zIndex: element.z_index
                } satisfies CSSProperties
              }
            >
              <div className={styles.visualMediaLayer}>
                <div
                  className={styles.visualFrame}
                  data-animation={animation}
                  style={
                    {
                      left: `${xPercent}%`,
                      top: `${yPercent}%`,
                      width: `${sizePercent}%`,
                      height: `${sizePercent}%`
                    } satisfies CSSProperties
                  }
                >
                  <video
                    ref={(ref) => {
                      if (ref) videoRefsRef.current.set(element.id, ref);
                      else videoRefsRef.current.delete(element.id);
                    }}
                    className={styles.visualMedia}
                    data-fit={fit}
                    src={element.media_url}
                    autoPlay
                    playsInline
                    onError={() => {
                      /* ignore */
                    }}
                  />
                </div>
              </div>
            </section>
          ) : null;
        })}
      </div>
    </main>
  );
}
