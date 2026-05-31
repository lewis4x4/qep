/**
 * Shared Playwright fixtures for quote-builder e2e.
 *
 * Auth: set PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD (repo secrets on CI).
 * Route /quote-v2 requires rep/admin/manager/owner — no VITE_E2E_TEST_AUTH bypass yet.
 */
export {
  playwrightTestCredentials,
  signInWithPassword,
} from "./helpers/auth";

export {
  advanceWizardNext,
  clickStepFooterNext,
  clickWizardProgressPill,
  ensureApprovalForCustomerFacing,
  expectApprovalBypassApplied,
  expectWizardStep,
  fillWhyThisMachine,
  generateDocumentPreview,
  pickFirstCrmCustomerAndStart,
  playwrightAgedEquipmentId,
  playwrightCrmCustomerQuery,
  selectFirstCatalogEquipment,
  selectFirstQuotingBranch,
  submitForApproval,
  waitForQuoteAutosave,
  walkCrmCustomerQuoteToReview,
  walkFromEquipmentToReview,
} from "./helpers/quote-wizard";
