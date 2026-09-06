/** QEP SOP-007: every question is accounted for; unknown is an honest answer. */
export const RENTAL_ASSESSMENT_FIELDS = [
  ["equipment_type", "Equipment", "Equipment type"],
  [
    "size_capacity_specs",
    "Equipment",
    "Size, capacity and required specifications",
  ],
  ["attachments", "Equipment", "Attachments"],
  ["desired_start_date", "Timeline", "Desired start date"],
  ["timeframe_flexibility", "Timeline", "Timeframe flexibility"],
  ["duration", "Timeline", "Duration [weekly or monthly]"],
  ["desired_return_date", "Timeline", "Desired return date"],
  ["project_location", "Job site", "Project location / delivery address"],
  ["site_conditions", "Job site", "Site conditions"],
  [
    "access_restrictions",
    "Job site",
    "Access restrictions: height, weight and grade",
  ],
  ["delivery", "Logistics", "Delivery or customer self-haul"],
  ["pickup", "Logistics", "Pickup required at return"],
  ["delivery_hours", "Logistics", "Preferred delivery hours"],
  ["account_status", "Customer", "New or existing account"],
  ["account_lookup", "Customer", "QRM / IntelliDealer lookup result"],
  ["customer_name", "Customer", "Customer name"],
  ["company_name", "Customer", "Company name"],
  ["email", "Customer", "Email"],
  ["jobsite_contact_name", "Customer", "Jobsite contact name"],
  ["jobsite_contact_phone", "Customer", "Jobsite contact phone"],
  [
    "operator_training",
    "Customer",
    "Training needed and Driver / Iron Advisor handoff",
  ],
  ["budget", "Customer", "Budget range or cost parameters"],
  ["insurance", "Customer", "LDW purchase or customer COI"],
  ["payment_method", "Customer", "Check, wire, credit card or charge account"],
] as const;
export type RentalAnswer = {
  status: "answered" | "unknown" | "not_applicable";
  value: string;
};
export type RentalNeedsAssessment = {
  answers: Record<string, RentalAnswer>;
  narrative: string;
  reviewed: boolean;
  return_date_confirmed: boolean;
};
export function emptyRentalAssessment(): RentalNeedsAssessment {
  return {
    answers: {},
    narrative: "",
    reviewed: false,
    return_date_confirmed: false,
  };
}
export function rentalAssessmentMissing(value: unknown): string[] {
  const a = value as Partial<RentalNeedsAssessment> | null;
  const missing: string[] = [];
  for (const [key, , label] of RENTAL_ASSESSMENT_FIELDS) {
    const answer = a?.answers?.[key];
    if (
      !answer ||
      !["answered", "unknown", "not_applicable"].includes(answer.status) ||
      (answer.status === "answered" &&
        (typeof answer.value !== "string" || !answer.value.trim()))
    ) missing.push(label);
  }
  for (const key of ["equipment_type", "duration", "delivery"]) {
    if (
      a?.answers?.[key]?.status !== "answered" ||
      (typeof a.answers[key].value !== "string" || !a.answers[key].value.trim())
    ) {
      missing.push(`Confirm ${key.replace(/_/g, " ")} before quoting`);
    }
  }
  if (
    a?.answers?.delivery?.status === "answered" &&
    !["delivery", "self_haul"].includes(a.answers.delivery.value)
  ) missing.push("Confirm delivery choice");
  if (!a?.reviewed) missing.push("Advisor review of all five categories");
  return [...new Set(missing)];
}

/** Recover valid answers from interrupted or older local drafts without trusting JSON shape. */
export function normalizeRentalAssessment(value: unknown): RentalNeedsAssessment {
  const result = emptyRentalAssessment();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const raw = value as Record<string, unknown>;
  result.narrative = typeof raw.narrative === "string" ? raw.narrative : "";
  result.reviewed = raw.reviewed === true;
  result.return_date_confirmed = raw.return_date_confirmed === true;
  const answers = raw.answers && typeof raw.answers === "object" ? raw.answers as Record<string, unknown> : {};
  for (const [key] of RENTAL_ASSESSMENT_FIELDS) {
    const a = answers[key] as Partial<RentalAnswer> | undefined;
    if (a && typeof a.value === "string" && ["answered", "unknown", "not_applicable"].includes(a.status ?? "")) result.answers[key] = a as RentalAnswer;
  }
  return result;
}
