import { describe, expect, test } from "bun:test";
import {
  FORGOT_PASSWORD_PATH,
  hasRecoveryHashType,
  hasRecoveryQueryFlag,
  isForgotPasswordPath,
  isResetPasswordPath,
  looksLikeRecoveryLanding,
  passwordResetRedirectUrl,
  RESET_PASSWORD_PATH,
} from "./password-recovery";

describe("password-recovery paths", () => {
  test("uses shared auth paths for internal and portal surfaces", () => {
    expect(FORGOT_PASSWORD_PATH).toBe("/forgot-password");
    expect(RESET_PASSWORD_PATH).toBe("/reset-password");
    expect(isForgotPasswordPath("/forgot-password")).toBe(true);
    expect(isResetPasswordPath("/reset-password")).toBe(true);
    expect(isForgotPasswordPath("/portal/forgot-password")).toBe(false);
    expect(isResetPasswordPath("/portal/reset-password")).toBe(false);
  });

  test("builds reset email redirect URLs to /reset-password", () => {
    expect(passwordResetRedirectUrl()).toBe(`${window.location.origin}${RESET_PASSWORD_PATH}`);
  });
});

describe("password-recovery landing detection", () => {
  test("detects recovery query flag", () => {
    expect(hasRecoveryQueryFlag("?recovery=1")).toBe(true);
    expect(hasRecoveryQueryFlag("?recovery=0")).toBe(false);
  });

  test("detects recovery hash tokens", () => {
    expect(hasRecoveryHashType("#access_token=abc&type=recovery")).toBe(true);
    expect(hasRecoveryHashType("access_token=abc&type=recovery")).toBe(true);
    expect(hasRecoveryHashType("#type=magiclink")).toBe(false);
  });

  test("treats either query or hash as a recovery landing", () => {
    expect(looksLikeRecoveryLanding("?recovery=1", "")).toBe(true);
    expect(looksLikeRecoveryLanding("", "#type=recovery")).toBe(true);
    expect(looksLikeRecoveryLanding("", "")).toBe(false);
  });
});
