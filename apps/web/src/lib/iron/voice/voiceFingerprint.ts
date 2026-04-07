/**
 * Wave 7 Iron Companion v1.1 — coarse speaker fingerprint.
 *
 * Real speaker diarization is hard. We don't need it. We just need to
 * answer one question reliably: "did the same person who started this flow
 * just speak, or is this a new voice?"
 *
 * The trick: compute a tiny vector from the FFT magnitude bins (mean energy
 * in 8 log-spaced frequency bands) over the last ~500ms of speech. Average
 * across the utterance. Compare to the stored fingerprint via cosine
 * similarity. If it drifts past a threshold, that's a new speaker.
 *
 * This is intentionally crude. It will produce false positives in a noisy
 * shop. The Iron UX treats a multi-voice signal as a non-blocking prompt
 * ("I'm hearing two voices — who's running this?"), never an automatic
 * rejection. The cost of being wrong is minimal; the value of being roughly
 * right is "Iron knows the second voice exists at all", which no commodity
 * QRM does.
 *
 * No external libraries. AudioContext + AnalyserNode are baseline browser
 * APIs available everywhere except IE11.
 */

const NUM_BANDS = 8;
const FFT_SIZE = 512; // Nyquist 11025 Hz at 22050 sample rate, fine for voice
const SILENCE_THRESHOLD = 0.005;

export interface SpeakerFingerprint {
  bands: Float32Array;
  /** Number of audio frames averaged into this fingerprint. */
  sampleCount: number;
}

export interface FingerprintAccumulator {
  bands: Float32Array;
  sampleCount: number;
  add(frame: Float32Array): void;
  toFingerprint(): SpeakerFingerprint;
}

/** Build an empty accumulator that callers feed FFT bin arrays into. */
export function createFingerprintAccumulator(): FingerprintAccumulator {
  const bands = new Float32Array(NUM_BANDS);
  let sampleCount = 0;

  return {
    bands,
    sampleCount,
    add(frame: Float32Array) {
      // Skip silence frames so the fingerprint represents actual voice
      let totalEnergy = 0;
      for (let i = 0; i < frame.length; i++) totalEnergy += frame[i];
      if (totalEnergy / frame.length < SILENCE_THRESHOLD) return;

      // Bin the FFT bins into NUM_BANDS log-spaced bands (rough mel-ish)
      const binsPerBand = Math.floor(frame.length / NUM_BANDS);
      for (let b = 0; b < NUM_BANDS; b++) {
        let bandSum = 0;
        const startBin = b * binsPerBand;
        const endBin = b === NUM_BANDS - 1 ? frame.length : startBin + binsPerBand;
        for (let i = startBin; i < endBin; i++) bandSum += frame[i];
        bands[b] += bandSum / (endBin - startBin);
      }
      sampleCount++;
    },
    toFingerprint() {
      const out = new Float32Array(NUM_BANDS);
      if (sampleCount === 0) return { bands: out, sampleCount: 0 };
      for (let b = 0; b < NUM_BANDS; b++) {
        out[b] = bands[b] / sampleCount;
      }
      // L2-normalize so cosine similarity is well-defined
      let norm = 0;
      for (let b = 0; b < NUM_BANDS; b++) norm += out[b] * out[b];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let b = 0; b < NUM_BANDS; b++) out[b] = out[b] / norm;
      }
      return { bands: out, sampleCount };
    },
  };
}

/**
 * Cosine similarity between two L2-normalized fingerprints.
 * Returns 1.0 for identical voices, ~0.7+ for the same person, <0.6 for
 * a different speaker (in our coarse 8-band space). These thresholds are
 * empirically tuned for the noisy-shop environment.
 */
export function fingerprintSimilarity(a: SpeakerFingerprint, b: SpeakerFingerprint): number {
  if (a.sampleCount === 0 || b.sampleCount === 0) return 1.0;
  let dot = 0;
  for (let i = 0; i < NUM_BANDS; i++) dot += a.bands[i] * b.bands[i];
  return dot;
}

/** Threshold below which we consider the second voice to be a different speaker. */
export const SECOND_VOICE_THRESHOLD = 0.62;

/**
 * Decide whether a new utterance came from the same speaker as the
 * canonical fingerprint. Returns true when the voices match.
 */
export function isLikelySameSpeaker(
  canonical: SpeakerFingerprint,
  candidate: SpeakerFingerprint,
): boolean {
  // If either fingerprint has fewer than 4 voice frames, refuse to judge
  // — too little signal. Default to "same speaker" to avoid false positives.
  if (canonical.sampleCount < 4 || candidate.sampleCount < 4) return true;
  return fingerprintSimilarity(canonical, candidate) >= SECOND_VOICE_THRESHOLD;
}

export const FINGERPRINT_FFT_SIZE = FFT_SIZE;
