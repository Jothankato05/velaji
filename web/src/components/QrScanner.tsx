import { useEffect, useRef, useState } from 'react';
import './QrScanner.css';

/**
 * Reads a card's QR code with the device camera. Uses the browser's own
 * BarcodeDetector where it has one (Chrome on Android), otherwise decodes
 * frames with jsQR, loaded only when the camera is actually opened.
 */

type Detect = (source: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>;

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

async function makeDetector(): Promise<Detect> {
  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
  if (BD) {
    try {
      const detector = new BD({ formats: ['qr_code'] });
      return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
    } catch {
      // Present but without QR support: fall through to jsQR.
    }
  }
  const { default: jsQR } = await import('jsqr');
  return async (video, canvas) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return jsQR(data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

export const cameraAvailable = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState('Starting the camera…');
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: start once; the callbacks are read at scan time
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detect = await makeDetector();
        setMessage('Point the camera at the QR code on the card.');
        const tick = async () => {
          if (stopped || !video.current || !canvas.current) return;
          try {
            const text = await detect(video.current, canvas.current);
            if (text && !stopped) {
              stopped = true;
              navigator.vibrate?.(60);
              onResult(text);
              return;
            }
          } catch {
            // A bad frame; try the next one.
          }
          timer = window.setTimeout(tick, 150);
        };
        void tick();
      } catch (err) {
        const name = (err as { name?: string })?.name;
        setFailed(true);
        setMessage(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Camera access is blocked. Allow the camera for this site in the browser settings, or type the CHIN instead.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No camera found on this device. Type the CHIN instead.'
              : 'The camera could not start. Type the CHIN instead.'
        );
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="qr-scanner">
      {!failed && (
        <div className="qr-frame">
          <video ref={video} className="qr-video" muted playsInline />
          <div className="qr-target" aria-hidden />
        </div>
      )}
      <canvas ref={canvas} hidden />
      <div className={`qr-msg${failed ? ' failed' : ''}`} role="status">{message}</div>
      <button type="button" className="btn btn-sm" onClick={onClose}>Close camera</button>
    </div>
  );
}
