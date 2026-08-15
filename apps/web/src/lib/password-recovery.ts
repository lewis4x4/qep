import type { LoginSurfaceMode } from "@/lib/login-page-copy";

export function forgotPasswordPath(mode: LoginSurfaceMode = "internal"): string {
  return mode === "portal" ? "/portal/forgot-password" : "/forgot-password";
}

export function resetPasswordPath(mode: LoginSurfaceMode = "internal"): string {
  return mode === "portal" ? "/portal/reset-password" : "/reset-password";
}

export function passwordResetRedirectUrl(mode: LoginSurfaceMode = "internal"): string {
  if (typeof window === "undefined") {
    return resetPasswordPath(mode);
  }
  return `${window.location.origin}${resetPasswordPath(mode)}`;
}

export function isForgotPasswordPath(pathname: string, mode: LoginSurfaceMode = "internal"): boolean {
  return pathname === forgotPasswordPath(mode);
}

export function isResetPasswordPath(pathname: string, mode: LoginSurfaceMode = "internal"): boolean {
  return pathname === resetPasswordPath(mode);
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
