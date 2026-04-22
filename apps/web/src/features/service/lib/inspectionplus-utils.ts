export type InspectionFindingTemplate = {
  key: string;
  section: string;
  label: string;
  required?: boolean;
  expectedValue?: string;
};

export type InspectionTemplateDefinition = {
  key: string;
  name: string;
  description: string;
  inspectionType: string;
  findings: InspectionFindingTemplate[];
};

export type InspectionFindingDraft = {
  template_item_key: string;
  section_label: string;
  finding_label: string;
  response: "pending";
  sort_order: number;
  expected_value: string | null;
};

export type InspectionFindingProgress = {
  total: number;
  completed: number;
  failed: number;
  pending: number;
};

export const INSPECTIONPLUS_TEMPLATES: InspectionTemplateDefinition[] = [
  {
    key: "general_condition",
    name: "General Condition",
    description: "Machine condition, operating controls, fluids, and visible wear points.",
    inspectionType: "equipment_condition",
    findings: [
      { key: "walkaround", section: "Walkaround", label: "Overall visual condition documented" },
      { key: "leaks", section: "Hydraulics", label: "No active oil or hydraulic leaks" },
      { key: "controls", section: "Operator Station", label: "Controls and display respond correctly" },
      { key: "safety", section: "Safety", label: "Safety decals, horn, lights, and guards present" },
      { key: "wear", section: "Undercarriage", label: "Undercarriage or tire wear captured" },
    ],
  },
  {
    key: "rental_return",
    name: "Rental Return",
    description: "Return-condition audit for rental check-in, damage capture, and charge review.",
    inspectionType: "rental_return",
    findings: [
      { key: "meter", section: "Return Intake", label: "Hour meter / usage recorded" },
      { key: "cleanliness", section: "Return Intake", label: "Unit cleanliness documented" },
      { key: "damage", section: "Damage", label: "Damage photos and notes captured" },
      { key: "attachments", section: "Attachments", label: "Returned attachments and loose items verified" },
      { key: "service_followup", section: "Disposition", label: "Service follow-up required identified" },
    ],
  },
  {
    key: "job_site_safety",
    name: "Job Site Safety",
    description: "Field technician safety walk before or during on-site service execution.",
    inspectionType: "job_site_safety",
    findings: [
      { key: "ppe", section: "Safety", label: "Technician PPE and site requirements confirmed" },
      { key: "access", section: "Access", label: "Machine access path and job-site hazards reviewed" },
      { key: "lockout", section: "Controls", label: "Lockout / isolation needs identified" },
      { key: "environment", section: "Environment", label: "Ground conditions and spill risk checked" },
      { key: "customer_contact", section: "Signoff", label: "Site contact / supervisor acknowledged arrival" },
    ],
  },
  {
    key: "equipment_demo",
    name: "Equipment Demo",
    description: "Structured demo form for machine walkthroughs, performance checks, and follow-up.",
    inspectionType: "equipment_demo",
    findings: [
      { key: "appearance", section: "Presentation", label: "Exterior appearance and branding reviewed" },
      { key: "startup", section: "Operation", label: "Startup, controls, and key functions demonstrated" },
      { key: "attachments", section: "Operation", label: "Attachment / implement operation verified" },
      { key: "customer_questions", section: "Customer", label: "Customer questions and concerns captured" },
      { key: "followup", section: "Follow-up", label: "Next-step action items documented" },
    ],
  },
];

export function makeInspectionNumber(now = new Date(), suffix?: string): string {
  const stamp = [
    String(now.getUTCFullYear()).slice(2),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = (suffix ?? Math.random().toString(36).slice(2, 6)).toUpperCase();
  return `IP-${stamp}-${random}`;
}

export function templateByKey(key: string): InspectionTemplateDefinition | null {
  return INSPECTIONPLUS_TEMPLATES.find((template) => template.key === key) ?? null;
}

export function buildInspectionFindingDrafts(template: InspectionTemplateDefinition): InspectionFindingDraft[] {
  return template.findings.map((finding, index) => ({
    template_item_key: finding.key,
    section_label: finding.section,
    finding_label: finding.label,
    response: "pending",
    sort_order: index,
    expected_value: finding.expectedValue ?? null,
  }));
}

export function summarizeInspectionFindings(
  findings: Array<{ response: string }>,
): InspectionFindingProgress {
  return findings.reduce<InspectionFindingProgress>(
    (summary, finding) => {
      summary.total += 1;
      if (finding.response === "fail") summary.failed += 1;
      if (finding.response === "pending") summary.pending += 1;
      if (finding.response !== "pending") summary.completed += 1;
      return summary;
    },
    { total: 0, completed: 0, failed: 0, pending: 0 },
  );
}

export function groupInspectionFindings<T extends { section_label: string; sort_order: number }>(
  findings: T[],
): Array<{ section: string; findings: T[] }> {
  const order: string[] = [];
  const grouped = new Map<string, T[]>();

  for (const finding of findings) {
    if (!grouped.has(finding.section_label)) {
      grouped.set(finding.section_label, []);
      order.push(finding.section_label);
    }
    grouped.get(finding.section_label)!.push(finding);
  }

  return order.map((section) => ({
    section,
    findings: [...(grouped.get(section) ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
}
