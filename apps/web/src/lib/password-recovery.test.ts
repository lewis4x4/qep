import { describe, expect, test } from "bun:test";
import {
  forgotPasswordPath,
  hasRecoveryHashType,
  hasRecoveryQueryFlag,
  isForgotPasswordPath,
  isResetPasswordPath,
  looksLikeRecoveryLanding,
  resetPasswordPath,
} from "./password-recovery";

describe("password-recovery paths", () => {
  test("uses internal auth paths by default", () => {
    expect(forgotPasswordPath()).toBe("/forgot-password");
    expect(resetPasswordPath()).toBe("/reset-password");
    expect(isForgotPasswordPath("/forgot-password")).toBe(true);
    expect(isResetPasswordPath("/reset-password")).toBe(true);
  });

  test("uses portal auth paths in portal mode", () => {
    expect(forgotPasswordPath("portal")).toBe("/portal/forgot-password");
    expect(resetPasswordPath("portal")).toBe("/portal/reset-password");
    expect(isForgotPasswordPath("/portal/forgot-password", "portal")).toBe(true);
    expect(isResetPasswordPath("/portal/reset-password", "portal")).toBe(true);
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
