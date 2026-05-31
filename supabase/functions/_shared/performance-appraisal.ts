export type AppraisalScorecardRole = "service_advisor" | "technician";
export type AppraisalBand = "Sub-Par" | "Normal" | "Excellent";
export type AppraisalReviewType =
  | "90-Day Review"
  | "Annual Performance Review"
  | "Merit Review";

export interface ScorecardCategory {
  scorecard_role: AppraisalScorecardRole;
  category_key: string;
  display_order: number;
  category_name: string;
  criteria: string[];
}

export const APPRAISAL_REVIEW_TYPES: readonly AppraisalReviewType[] = [
  "90-Day Review",
  "Annual Performance Review",
  "Merit Review",
] as const;

export const APPRAISAL_MANAGER_ROLES = new Set(["admin", "manager", "owner"]);
export const APPRAISAL_ALLOWED_ROLES = [
  "admin",
  "manager",
  "owner",
  "service_writer",
  "technician",
] as const;

export const SERVICE_ADVISOR_SCORECARD: readonly ScorecardCategory[] = [
  {
    scorecard_role: "service_advisor",
    category_key: "attendance_reliability_time_management",
    display_order: 1,
    category_name: "Attendance, Reliability & Time Management",
    criteria: [
      "Reports to work on time and ready to work",
      "Maintains consistent availability during business hours",
      "Manages daily workload efficinelty",
      "Responds to requests in a timely mannner",
      "Follows through on commitments and deadlines",
    ],
  },
  {
    scorecard_role: "service_advisor",
    category_key: "customer_service_communication",
    display_order: 2,
    category_name: "Customer Service & Communication",
    criteria: [
      "Communicates clearly and professionally with customers",
      "Sets accurate expectations on timing, cost, and scope",
      "Clarity of communication when explaining repairs, timelines, and costs",
      "Tone and attitude is polite, patient, empathetic",
      "Follow-up habits — updates customers throughout their repair",
    ],
  },
  {
    scorecard_role: "service_advisor",
    category_key: "work_order_quality_accuracy",
    display_order: 3,
    category_name: "Work Order Quality & Accuracy",
    criteria: [
      "Creates clear, complete, and accurate work orders",
      "Accurately captures customer concerns and job details",
      "Ensures labor, parts, and notes are properly documented",
      "Reviews work orders for accuracy before closing",
      "Minimizes errors that lead to rework or billing issues",
    ],
  },
  {
    scorecard_role: "service_advisor",
    category_key: "workflow_job_coordination",
    display_order: 4,
    category_name: "Workflow & Job Coordination",
    criteria: [
      "Coordinates effectively between customers, technicians, and parts",
      "Prioritizes jobs based on urgency and shop capacity",
      "Keeps jobs moving through the shop without unnecessary delays",
      "Proactively addresses scheduling conflicts or delays",
      "Maintains awareness of job status and next steps at all times",
    ],
  },
  {
    scorecard_role: "service_advisor",
    category_key: "parts_billing_awareness",
    display_order: 5,
    category_name: "Parts & Billing Awareness",
    criteria: [
      "Works with parts to ensure correct and timely ordering",
      "Understands basic parts availability and lead times",
      "Ensures accurate billing of labor, parts, and misc. charges",
      "Minimizes missed billable items",
      "Verifies completed work is properly invoiced",
    ],
  },
  {
    scorecard_role: "service_advisor",
    category_key: "professionalism_teamwork",
    display_order: 6,
    category_name: "Professionalism & Teamwork",
    criteria: [
      "Works effectively with technicians, parts, and management",
      "Positive attitude with coworkers",
      "Communicates respectfully and constructively with others",
      "Accepts feedback and applies it appropriately",
      "Takes ownership of mistakes and works toward resolution",
    ],
  },
  {
    scorecard_role: "service_advisor",
    category_key: "initiative_problem_solving",
    display_order: 7,
    category_name: "Initiative & Problem Solving",
    criteria: [
      "Takes action to move jobs forward without being prompted",
      "Identifies and resolves issues before they escalate",
      "Shows initiative to improve processes or quality",
      "Adapts to new equipment, technology, or procedures",
      "Demonstrates readiness for increased responsibility",
    ],
  },
] as const;

export const TECHNICIAN_SCORECARD: readonly ScorecardCategory[] = [
  {
    scorecard_role: "technician",
    category_key: "attendance_reliability_time_management",
    display_order: 1,
    category_name: "Attendance, Reliability & Time Management",
    criteria: [
      "Reports to work on time and ready to work",
      "Follows assigned schedule (shop hours, dispatch assignments, build timelines)",
      "Manages time efficiently during the workday",
      "Minimizes unproductive or idle time",
      "Uses overtime appropriately and with approval",
      "Reliable availability for assigned duties (road calls, builds, shop work)",
    ],
  },
  {
    scorecard_role: "technician",
    category_key: "work_quality_technical_execution",
    display_order: 2,
    category_name: "Work Quality & Technical Execution",
    criteria: [
      "Completes repairs accurately the first time",
      "Follows manufacturer specs and company procedures",
      "Demonstrates appropriate diagnostic skills for assigned work",
      "Performs clean, professional workmanship",
      "Uses proper tools and equipment correctly",
      "Verifies repairs before releasing equipment to prevent rework",
    ],
  },
  {
    scorecard_role: "technician",
    category_key: "safety_compliance_equipment_care",
    display_order: 3,
    category_name: "Safety, Compliance & Equipment Care",
    criteria: [
      "Follows all safety procedures and PPE requirements",
      "Uses tools and equipment safely and as intended",
      "Maintains a clean and safe work area (shop, field, or build area)",
      "Properly secures equipment, tools, and materials",
      "Reports hazards, near misses, and incidents promptly",
      "Cares for company and customer equipment",
    ],
  },
  {
    scorecard_role: "technician",
    category_key: "productivity_job_management",
    display_order: 4,
    category_name: "Productivity & Job Management",
    criteria: [
      "Completes jobs within reasonable or estimated labor time",
      "Manages assigned tasks with minimal supervision",
      "Stays focused on assigned work and avoids unnecessary rework",
      "Uses downtime productively",
      "Adjusts work approach based on job complexity and priorities",
    ],
  },
  {
    scorecard_role: "technician",
    category_key: "documentation_communication",
    display_order: 5,
    category_name: "Documentation & Communication",
    criteria: [
      "Completes work orders accurately and thoroughly",
      "Documents diagnostics, labor, and repairs clearly",
      "Communicates issues, delays, or additional repair needs promptly",
      "Coordinates effectively with service writers, managers, and parts",
      "Closes work orders in a timely manner",
    ],
  },
  {
    scorecard_role: "technician",
    category_key: "professional_conduct_teamwork",
    display_order: 6,
    category_name: "Professional Conduct & Teamwork",
    criteria: [
      "Maintains a professional attitude and conduct",
      "Accepts direction and feedback constructively",
      "Works cooperatively with coworkers and other departments",
      "Takes responsibility for mistakes and works to correct them",
      "Represents the company professionally when interacting with others",
    ],
  },
  {
    scorecard_role: "technician",
    category_key: "technical_growth_initiative",
    display_order: 7,
    category_name: "Technical Growth & Initiative",
    criteria: [
      "Demonstrates willingness to learn and improve skills",
      "Seeks training or certifications when applicable",
      "Shows initiative to improve processes or quality",
      "Adapts to new equipment, technology, or procedures",
      "Demonstrates readiness for increased responsibility",
    ],
  },
] as const;

export function bandForScore(score: number | null | undefined): AppraisalBand | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score < 4) return "Sub-Par";
  if (score < 8) return "Normal";
  return "Excellent";
}

export function computeOverallScore(scores: readonly number[]): number | null {
  if (scores.length !== 7) return null;
  if (!scores.every((score) => Number.isInteger(score) && score >= 1 && score <= 10)) {
    return null;
  }
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / 7) * 100) / 100;
}

export function computePerformanceRaisePct(overallScore: number | null | undefined): number | null {
  if (overallScore == null || !Number.isFinite(overallScore)) return null;
  return Math.round(Math.max(0, overallScore) * 100) / 100;
}

export function computeRecommendedRaisePct(
  costOfLivingPct: number | null | undefined,
  performancePct: number | null | undefined,
): number | null {
  if (costOfLivingPct == null || performancePct == null) return null;
  if (!Number.isFinite(costOfLivingPct) || !Number.isFinite(performancePct)) return null;
  return Math.round((Math.max(0, costOfLivingPct) + Math.max(0, performancePct)) * 100) / 100;
}

export function canAuthorPerformanceAppraisal(role: string | null | undefined): boolean {
  return role != null && APPRAISAL_MANAGER_ROLES.has(role);
}

export function isReviewType(value: unknown): value is AppraisalReviewType {
  return typeof value === "string" &&
    (APPRAISAL_REVIEW_TYPES as readonly string[]).includes(value);
}

export function isScorecardRole(value: unknown): value is AppraisalScorecardRole {
  return value === "service_advisor" || value === "technician";
}
