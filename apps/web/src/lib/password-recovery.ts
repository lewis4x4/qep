export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";

export function passwordResetRedirectUrl(): string {
  if (typeof window === "undefined") {
    return RESET_PASSWORD_PATH;
  }
  return `${window.location.origin}${RESET_PASSWORD_PATH}`;
}

export function isForgotPasswordPath(pathname: string): boolean {
  return pathname === FORGOT_PASSWORD_PATH;
}

export function isResetPasswordPath(pathname: string): boolean {
  return pathname === RESET_PASSWORD_PATH;
}

export function hasRecoveryQueryFlag(search: string): boolean {
  return new URLSearchParams(search).get("recovery") === "1";
}

export function hasRecoveryHashType(hash: string): boolean {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!normalized) {
    return false;
  }
  const params = new URLSearchParams(normalized);
  return params.get("type") === "recovery";
}

export function looksLikeRecoveryLanding(search: string, hash: string): boolean {
  return hasRecoveryQueryFlag(search) || hasRecoveryHashType(hash);
}
