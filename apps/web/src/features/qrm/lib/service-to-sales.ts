export interface ServiceToSalesJob {
  id: string;
  customerId: string | null;
  machineId: string | null;
  currentStage: string;
  scheduledEndAt: string | null;
  createdAt: string;
  customerProblemSummary: string | null;
  invoiceTotal: number | null;
}

export interface ServiceToSalesMachine {
  id: string;
  companyId: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  ownership: "owned" | "leased" | "customer_owned" | "rental_fleet" | "consignment";
  engineHours: number | null;
  currentMarketValue: number | null;
  replacementCost: number | null;
}

export interface ServiceToSalesFleetSignal {
  equipmentSerial?: string | null;
  make: string;
  model: string;
  year: number | null;
  predictedReplacementDate: string | null;
  replacementConfidence: number | null;
  outreachStatus: string | null;
  outreachDealValue: number | null;
}

export interface ServiceToSalesCase {
  machineId: string;
  companyId: string;
  machineName: string;
  customerId: string | null;
  serviceCount180d: number;
  openJobCount: number;
  overdueOpenJobs: number;
  totalServiceSpend: number;
  recurringProblem: string | null;
  engineHours: number | null;
  tradePressure: "high" | "medium" | "low";
  replacementDate: string | null;
  replacementConfidence: number | null;
  outreachDealValue: number | null;
  reasons: string[];
}

export interface ServiceToSalesSummary {
  totalCases: number;
  highPressureCases: number;
  openRevenueCandidates: number;
  overdueCases: number;
}

export interface ServiceToSalesBoard {
  summary: ServiceToSalesSummary;
  cases: ServiceToSalesCase[];
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isOpenStage(stage: string): boolean {
  return !["closed", "invoiced", "cancelled"].includes(stage);
}

function matchFleetSignal(machine: ServiceToSalesMachine, signals: ServiceToSalesFleetSignal[]): ServiceToSalesFleetSignal | null {
  const normalizedMake = machine.make?.trim().toLowerCase();
  const normalizedModel = machine.model?.trim().toLowerCase();
  const direct = signals.find((signal) =>
    signal.year === machine.year &&
    signal.make.trim().toLowerCase() === normalizedMake &&
    signal.model.trim().toLowerCase() === normalizedModel,
  );
  return direct ?? null;
}

export function buildServiceToSalesBoard(
  jobs: ServiceToSalesJob[],
  machines: ServiceToSalesMachine[],
  signals: ServiceToSalesFleetSignal[],
  nowTime = Date.now(),
): ServiceToSalesBoard {
  const horizon = nowTime - 180 * 86_400_000;
  const machineById = new Map(
    machines
      .filter((machine) => machine.ownership === "customer_owned")
      .map((machine) => [machine.id, machine]),
  );

  const jobGroups = new Map<string, ServiceToSalesJob[]>();
  for (const job of jobs) {
    if (!job.machineId) continue;
    const machine = machineById.get(job.machineId);
    if (!machine) continue;
    const createdAt = parseTime(job.createdAt);
    if (createdAt == null || createdAt < horizon) continue;
    const list = jobGroups.get(job.machineId) ?? [];
    list.push(job);
    jobGroups.set(job.machineId, list);
  }

  const cases: ServiceToSalesCase[] = [];
  for (const [machineId, machineJobs] of jobGroups.entries()) {
    const machine = machineById.get(machineId);
    if (!machine) continue;
    const serviceCount180d = machineJobs.length;
    const openJobs = machineJobs.filter((job) => isOpenStage(job.currentStage));
    const overdueOpenJobs = openJobs.filter((job) => {
      const scheduled = parseTime(job.scheduledEndAt);
      return scheduled != null && scheduled < nowTime;
    }).length;
    const totalServiceSpend = machineJobs.reduce((sum, job) => sum + (job.invoiceTotal ?? 0), 0);
    const recurringProblem = machineJobs[0]?.customerProblemSummary ?? null;
    const signal = matchFleetSignal(machine, signals);
    const replacementConfidence = signal?.replacementConfidence ?? null;
    const outreachDealValue = signal?.outreachDealValue ?? null;

    const reasons: string[] = [];
    let tradePressure: "high" | "medium" | "low" = "low";

    if (serviceCount180d >= 3) {
      reasons.push(`${serviceCount180d} service jobs in the last 180 days`);
      tradePressure = "high";
    } else if (serviceCount180d >= 2) {
      reasons.push(`${serviceCount180d} service jobs in the last 180 days`);
      tradePressure = "medium";
    }

    if (overdueOpenJobs > 0) {
      reasons.push(`${overdueOpenJobs} overdue open service job${overdueOpenJobs === 1 ? "" : "s"}`);
      tradePressure = "high";
    }

    if (totalServiceSpend >= 10_000) {
      reasons.push(`service spend ${Math.round(totalServiceSpend / 1000)}k in 180 days`);
      if (tradePressure === "low") tradePressure = "medium";
    }

    if ((replacementConfidence ?? 0) >= 0.75) {
      reasons.push(`replacement confidence ${Math.round((replacementConfidence ?? 0) * 100)}%`);
      tradePressure = "high";
    } else if ((replacementConfidence ?? 0) >= 0.5 && tradePressure === "low") {
      reasons.push(`replacement confidence ${Math.round((replacementConfidence ?? 0) * 100)}%`);
      tradePressure = "medium";
    }

    if (reasons.length === 0) continue;

    cases.push({
      machineId,
      companyId: machine.companyId,
      machineName: machine.name,
      customerId: machineJobs[0]?.customerId ?? machine.companyId,
      serviceCount180d,
      openJobCount: openJobs.length,
      overdueOpenJobs,
      totalServiceSpend,
      recurringProblem,
      engineHours: machine.engineHours,
      tradePressure,
      replacementDate: signal?.predictedReplacementDate ?? null,
      replacementConfidence,
      outreachDealValue,
      reasons,
    });
  }

  cases.sort((a, b) => {
    const weight = { high: 3, medium: 2, low: 1 };
    if (weight[b.tradePressure] !== weight[a.tradePressure]) {
      return weight[b.tradePressure] - weight[a.tradePressure];
    }
    if (b.totalServiceSpend !== a.totalServiceSpend) {
      return b.totalServiceSpend - a.totalServiceSpend;
    }
    return b.serviceCount180d - a.serviceCount180d;
  });

  return {
    summary: {
      totalCases: cases.length,
      highPressureCases: cases.filter((item) => item.tradePressure === "high").length,
      openRevenueCandidates: cases.filter((item) => (item.outreachDealValue ?? 0) > 0).length,
      overdueCases: cases.filter((item) => item.overdueOpenJobs > 0).length,
    },
    cases,
  };
}
