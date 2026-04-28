"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import {
  STAGE_OVERLAY_POLL_MS,
  clampStageAudioVolumePercent,
  clampStageDisplayCoordinatePercent,
  clampStageDisplaySizePercent,
  getOverlayStateByStream,
  normalizeStageDisplayFit,
  normalizeStageEntryAnimation,
  type OverlayActiveElement,
  type OverlayStateResponse
} from "@/lib/live-stage";
import styles from "./page.module.css";

export default function LiveStageOverlayPage() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRefsRef = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const lastVersionRef = useRef(-1);
  const seenElementIdsRef = useRef<Set<string>>(new Set());

  const [elements, setElements] = useState<OverlayActiveElement[]>([]);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState("");

  function stopAudio() {
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
  }

  async function loadOverlayState(targetStream: string) {
    try {
      setStreamError("");
      const payload: OverlayStateResponse = await getOverlayStateByStream(targetStream);

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

      if (playingAudioId) {
        const stillHasPlayingAudio = validElements.some(
          (element) => element.id === playingAudioId && element.media_type === "sound"
        );
        if (!stillHasPlayingAudio) {
          stopAudio();
        }
      }

      const nextIds = new Set(validElements.map((element) => element.id));
      const previousIds = seenElementIdsRef.current;
      const newSoundElements = validElements.filter(
        (element) => element.media_type === "sound" && !previousIds.has(element.id)
      );

      seenElementIdsRef.current = nextIds;
      setElements(validElements);

      if (newSoundElements.length > 0) {
        playAudioElement(newSoundElements[newSoundElements.length - 1]);
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Falha ao atualizar overlay.";
      setStreamError(message);
      console.warn("Falha ao atualizar overlay do palco:", message);
    }
  }

  useEffect(() => {
    document.documentElement.classList.add("tw-stage-overlay-html");
    document.body.classList.add("tw-stage-overlay-body");

    const params = new URLSearchParams(window.location.search);
    const requestedStream =
      params.get("stream") || window.localStorage.getItem("tw:last-stream-handle") || "";

    if (!requestedStream) {
      setStreamError(
        "Parametro stream ausente. Copie novamente a URL completa do painel (com ?stream=handle)."
      );
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
      seenElementIdsRef.current.clear();
      stopAudio();
      document.documentElement.classList.remove("tw-stage-overlay-html");
      document.body.classList.remove("tw-stage-overlay-body");
    };
  }, []);

  // Handle video playback (only for newly inserted videos)
  useEffect(() => {
    for (const element of elements) {
      if (element.media_type !== "video") continue;

      const videoRef = videoRefsRef.current.get(element.id);
      if (!videoRef) continue;

      if (videoRef.dataset.started === "true") continue;
      videoRef.dataset.started = "true";
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
      {streamError ? (
        <div className={styles.overlayError}>
          {streamError}
        </div>
      ) : null}
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
                    preload="auto"
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
