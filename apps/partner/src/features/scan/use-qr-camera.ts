import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import { decodeQr } from './decode-frame';

export type CameraStatus = 'idle' | 'starting' | 'running' | 'denied' | 'unavailable' | 'error';

export const DECODE_INTERVAL_MS = 125;
export const MAX_CANVAS_DIMENSION = 640;

export interface UseQrCameraOptions {
  enabled: boolean;
  onDecode: (code: string) => void;
}

export interface UseQrCameraResult {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  retry: () => void;
}

export function useQrCamera({ enabled, onDecode }: UseQrCameraOptions): UseQrCameraResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [retryTrigger, setRetryTrigger] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastDecodedRef = useRef<string | null>(null);
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;

  // Reset mã đã đọc khi enabled thay đổi (bật lại quét mới)
  useEffect(() => {
    lastDecodedRef.current = null;
  }, [enabled]);

  const stopTracksAndRaf = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const retry = useCallback(() => {
    setRetryTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      stopTracksAndRaf();
      setStatus('idle');
      return;
    }

    // Mỗi lần mở camera là một phiên: phiên cũ (tab ẩn, tắt, mở lại) không được giữ stream hay đổi trạng thái.
    let session = 0;
    let canvas: HTMLCanvasElement | null = null;
    let lastDecodeTime = 0;

    async function startCamera() {
      session += 1;
      const current = session;
      stopTracksAndRaf();
      setStatus('starting');

      if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
        setStatus('unavailable');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });

        if (current !== session) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.playsInline = true;
          video.muted = true;
          video.autoplay = true;
          video.setAttribute('playsinline', 'true');
          try {
            await video.play();
          } catch {
            // Safari hoặc autoplay policy có thể chặn nếu chưa có tương tác
          }
        }

        if (current === session) {
          setStatus('running');
          startDecodingLoop(current);
        }
      } catch (err) {
        if (current !== session) return;
        const name = err instanceof Error || err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setStatus('denied');
        } else if (
          name === 'NotFoundError' ||
          name === 'DevicesNotFoundError' ||
          name === 'OverconstrainedError'
        ) {
          setStatus('unavailable');
        } else {
          setStatus('error');
        }
      }
    }

    function startDecodingLoop(current: number) {
      function tick() {
        if (current !== session) return;

        const video = videoRef.current;
        const now = Date.now();

        // Chỉ xử lý khi video đã có dữ liệu (HAVE_CURRENT_DATA = 2) và đủ chu kỳ DECODE_INTERVAL_MS
        if (
          video &&
          video.readyState >= 2 &&
          video.videoWidth > 0 &&
          video.videoHeight > 0 &&
          now - lastDecodeTime >= DECODE_INTERVAL_MS
        ) {
          lastDecodeTime = now;

          if (!canvas) {
            canvas = document.createElement('canvas');
          }

          const vw = video.videoWidth;
          const vh = video.videoHeight;
          let cw = vw;
          let ch = vh;

          // Giới hạn cạnh lớn nhất không quá MAX_CANVAS_DIMENSION (640)
          if (cw > MAX_CANVAS_DIMENSION || ch > MAX_CANVAS_DIMENSION) {
            if (cw > ch) {
              ch = Math.round((ch * MAX_CANVAS_DIMENSION) / cw);
              cw = MAX_CANVAS_DIMENSION;
            } else {
              cw = Math.round((cw * MAX_CANVAS_DIMENSION) / ch);
              ch = MAX_CANVAS_DIMENSION;
            }
          }

          if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw;
            canvas.height = ch;
          }

          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            try {
              ctx.drawImage(video, 0, 0, cw, ch);
              const imgData = ctx.getImageData(0, 0, cw, ch);
              const code = decodeQr(imgData.data, cw, ch);
              if (code && code !== lastDecodedRef.current) {
                lastDecodedRef.current = code;
                onDecodeRef.current(code);
              }
            } catch {
              // Bỏ qua lỗi canvas vẽ frame
            }
          }
        }

        rafIdRef.current = requestAnimationFrame(tick);
      }

      rafIdRef.current = requestAnimationFrame(tick);
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        session += 1;
        stopTracksAndRaf();
        setStatus('idle');
      } else {
        void startCamera();
      }
    }

    if (!document.hidden) void startCamera();

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      session += 1;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopTracksAndRaf();
    };
  }, [enabled, retryTrigger, stopTracksAndRaf]);

  return {
    videoRef,
    status,
    retry,
  };
}
