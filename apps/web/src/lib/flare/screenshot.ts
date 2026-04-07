/**
 * Wave 6.11 Flare — screenshot + DOM snapshot capture.
 */
import html2canvas from "html2canvas";
import pako from "pako";
import { blankSensitiveInputs } from "./redactPII";

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;       // 2MB
const MAX_DOM_SNAPSHOT_BYTES = 500 * 1024;          // 500KB compressed

/**
 * Take a PNG screenshot of the current document body.
 * Returns a data URL (base64). Truncated to MAX_SCREENSHOT_BYTES.
 */
export async function captureScreenshot(): Promise<string> {
  try {
    const canvas = await html2canvas(document.body, {
      logging: false,
      useCORS: true,
      backgroundColor: "#0a0a0a",
      scale: Math.min(window.devicePixelRatio, 2), // cap at 2x to bound size
      // html2canvas clones the DOM internally; we redact the clone here
      onclone: (clonedDoc) => {
        blankSensitiveInputs(clonedDoc);
      },
    });
    const dataUrl = canvas.toDataURL("image/png");
    if (dataUrl.length > MAX_SCREENSHOT_BYTES) {
      // Try lower quality JPEG as fallback
      const jpegUrl = canvas.toDataURL("image/jpeg", 0.8);
      return jpegUrl.slice(0, MAX_SCREENSHOT_BYTES);
    }
    return dataUrl;
  } catch (err) {
    console.warn("[flare] screenshot capture failed:", err);
    // Return a minimal valid PNG data URL so the edge fn upload still succeeds
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
  }
}

/**
 * Snapshot the current DOM as sanitized HTML, gzipped, base64-encoded.
 * Blanks sensitive inputs first. Capped at MAX_DOM_SNAPSHOT_BYTES.
 */
export function captureDomSnapshot(): string {
  try {
    const clone = document.documentElement.cloneNode(true) as Element;
    blankSensitiveInputs(clone);

    // Strip script tags to reduce size and avoid replaying privileged code
    clone.querySelectorAll("script").forEach((n) => n.remove());
    // Strip <style> inner rules — keep the tags for structure but blank content
    clone.querySelectorAll("style").forEach((n) => { n.textContent = ""; });

    const html = clone.outerHTML;
    const gzipped = pako.gzip(html);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(gzipped)));

    if (b64.length > MAX_DOM_SNAPSHOT_BYTES) {
      // Truncated — still return the head for partial context
      return b64.slice(0, MAX_DOM_SNAPSHOT_BYTES);
    }
    return b64;
  } catch (err) {
    console.warn("[flare] DOM snapshot failed:", err);
    return "";
  }
}
