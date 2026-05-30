import { assertEquals } from "jsr:@std/assert@1";
import {
  bandForScore,
  canAuthorPerformanceAppraisal,
  computeOverallScore,
  computePerformanceRaisePct,
  computeRecommendedRaisePct,
  SERVICE_ADVISOR_SCORECARD,
  TECHNICIAN_SCORECARD,
} from "./performance-appraisal.ts";

Deno.test("performance appraisal scorecards keep exactly seven equal-weight categories per role", () => {
  assertEquals(SERVICE_ADVISOR_SCORECARD.map((category) => category.category_name), [
    "Attendance, Reliability & Time Management",
    "Customer Service & Communication",
    "Work Order Quality & Accuracy",
    "Workflow & Job Coordination",
    "Parts & Billing Awareness",
    "Professionalism & Teamwork",
    "Initiative & Problem Solving",
  ]);
  assertEquals(TECHNICIAN_SCORECARD.map((category) => category.category_name), [
    "Attendance, Reliability & Time Management",
    "Work Quality & Technical Execution",
    "Safety, Compliance & Equipment Care",
    "Productivity & Job Management",
    "Documentation & Communication",
    "Professional Conduct & Teamwork",
    "Technical Growth & Initiative",
  ]);
  assertEquals(SERVICE_ADVISOR_SCORECARD.length, 7);
  assertEquals(TECHNICIAN_SCORECARD.length, 7);
});

Deno.test("performance appraisal band thresholds match workbook/roadmap rules", () => {
  assertEquals(bandForScore(1), "Sub-Par");
  assertEquals(bandForScore(3.99), "Sub-Par");
  assertEquals(bandForScore(4), "Normal");
  assertEquals(bandForScore(7.99), "Normal");
  assertEquals(bandForScore(8), "Excellent");
  assertEquals(bandForScore(10), "Excellent");
});

Deno.test("performance appraisal overall score averages all seven categories equally", () => {
  assertEquals(computeOverallScore([10, 9, 8, 7, 6, 5, 4]), 7);
  assertEquals(computeOverallScore([1, 5, 8, 4, 2, 4, 7]), 4.43);
  assertEquals(computeOverallScore([10, 9, 8, 7, 6, 5]), null);
  assertEquals(computeOverallScore([10, 9, 8, 7, 6, 5, 11]), null);
});

Deno.test("performance appraisal raise recommendation is Cost of Living plus Performance", () => {
  const overall = computeOverallScore([8, 8, 8, 8, 8, 8, 8]);
  const performance = computePerformanceRaisePct(overall);
  assertEquals(performance, 8);
  assertEquals(computeRecommendedRaisePct(3, performance), 11);
  assertEquals(computeRecommendedRaisePct(2.5, 4.43), 6.93);
});

Deno.test("performance appraisal authoring is restricted to manager/admin/owner roles", () => {
  assertEquals(canAuthorPerformanceAppraisal("manager"), true);
  assertEquals(canAuthorPerformanceAppraisal("admin"), true);
  assertEquals(canAuthorPerformanceAppraisal("owner"), true);
  assertEquals(canAuthorPerformanceAppraisal("service_writer"), false);
  assertEquals(canAuthorPerformanceAppraisal("technician"), false);
});
