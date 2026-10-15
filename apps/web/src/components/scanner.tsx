"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "./client";
import { Button } from "./ui";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

export function cameraScanSupported() {
  return typeof window !== "undefined" && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Camera barcode scanner using the browser's BarcodeDetector API (Chrome on
 * Android, recent desktop Chrome/Edge). USB/Bluetooth scanners work without
 * this — they type into the barcode field like a keyboard.
 */
export function CameraScanner({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        if (!window.BarcodeDetector) throw new Error("This browser cannot scan with the camera. Use a barcode scanner or type the code.");
        const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code", "itf"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes[0]?.rawValue) {
              onCode(codes[0].rawValue);
              onClose();
              return;
            }
          } catch {
            /* frame not ready */
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Camera unavailable");
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onClose, onCode]);

  return (
    <Modal open={open} onClose={onClose} title="Scan barcode" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {err ? (
        <p className="text-sm text-red-700">{err}</p>
      ) : (
        <div className="overflow-hidden rounded-xl bg-black">
          <video ref={video} className="aspect-video w-full object-cover" muted playsInline />
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Point the camera at the barcode. It is read automatically.</p>
    </Modal>
  );
}
