export interface MicrophoneProblem {
  kind: "denied" | "unsupported" | "missing_device" | "busy" | "unknown";
  title: string;
  description: string;
  recovery?: string;
}

const MICROPHONE_PERMISSION_RECOVERY =
  "Use the site controls in the address bar to allow Microphone, then reload this page and try again.";

export function getMicrophoneSupportProblem(): MicrophoneProblem | null {
  if (typeof window === "undefined") return null;

  if (!window.isSecureContext) {
    return {
      kind: "unsupported",
      title: "Secure connection required",
      description: "Recording only works on a secure HTTPS page.",
    };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      kind: "unsupported",
      title: "Microphone recording is not available here",
      description: "This browser does not expose microphone capture for this page.",
    };
  }

  if (typeof MediaRecorder === "undefined") {
    return {
      kind: "unsupported",
      title: "Recording is not supported in this browser",
      description: "Switch to a current Chrome, Edge, Firefox, or Safari build and try again.",
    };
  }

  return null;
}

export function getMicrophoneProblemFromError(error: unknown): MicrophoneProblem {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : "The browser could not start the microphone.";
  const normalizedMessage = rawMessage.toLowerCase();
  const errorName =
    typeof DOMException !== "undefined" && error instanceof DOMException
      ? error.name
      : error instanceof Error
        ? error.name
        : "";

  if (
    errorName === "NotAllowedError" ||
    errorName === "SecurityError" ||
    /permission|denied|not allowed/.test(normalizedMessage)
  ) {
    return {
      kind: "denied",
      title: "Microphone access is blocked",
      description: "This browser is currently denying microphone access for this site.",
      recovery: MICROPHONE_PERMISSION_RECOVERY,
    };
  }

  if (
    errorName === "NotFoundError" ||
    /no microphone|no audio input|device not found|requested device not found/.test(normalizedMessage)
  ) {
    return {
      kind: "missing_device",
      title: "No microphone found",
      description: "Connect or enable a microphone, then try again.",
    };
  }

  if (
    errorName === "NotReadableError" ||
    errorName === "TrackStartError" ||
    /not readable|track start|device in use|could not start audio source/.test(normalizedMessage)
  ) {
    return {
      kind: "busy",
      title: "Microphone is busy",
      description: "Another tab or app is already using the microphone. Close it, then try again.",
    };
  }

  return (
    getMicrophoneSupportProblem() ?? {
      kind: "unknown",
      title: "Could not start recording",
      description: rawMessage,
    }
  );
}

export async function getInitialMicrophoneProblem(): Promise<MicrophoneProblem | null> {
  const supportProblem = getMicrophoneSupportProblem();
  if (supportProblem) return supportProblem;

  if (!navigator.permissions?.query) {
    return null;
  }

  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (status.state === "denied") {
      return {
        kind: "denied",
        title: "Microphone access is blocked",
        description: "This browser is currently denying microphone access for this site.",
        recovery: MICROPHONE_PERMISSION_RECOVERY,
      };
    }
  } catch {
    // Browsers may not support microphone permission introspection.
  }

  return null;
}
