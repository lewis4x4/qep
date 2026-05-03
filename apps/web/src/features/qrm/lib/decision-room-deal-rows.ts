export interface DecisionRoomWonDealRow {
  id: string;
  name: string | null;
  amount: number | null;
  company_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  expected_close_on: string | null;
  stage_id: string | null;
}

export interface DecisionRoomLostDealRow {
  id: string;
  name: string | null;
  amount: number | null;
  loss_reason: string | null;
  competitor: string | null;
  company_id: string | null;
  expected_close_on: string | null;
  updated_at: string | null;
}

export interface DecisionRoomRecentLossRow {
  id: string;
  name: string | null;
  amount: number | null;
  loss_reason: string | null;
  competitor: string | null;
  updated_at: string | null;
}

export interface DecisionRoomStageRow {
  id: string;
  is_closed_won: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeDecisionRoomStageRows(rows: unknown): DecisionRoomStageRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      is_closed_won: row.is_closed_won === true,
    }];
  });
}

export function normalizeDecisionRoomWonDealRows(rows: unknown): DecisionRoomWonDealRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      name: nullableString(row.name),
      amount: nullableNumber(row.amount),
      company_id: nullableString(row.company_id),
      created_at: nullableString(row.created_at),
      updated_at: nullableString(row.updated_at),
      expected_close_on: nullableString(row.expected_close_on),
      stage_id: nullableString(row.stage_id),
    }];
  });
}

export function normalizeDecisionRoomLostDealRows(rows: unknown): DecisionRoomLostDealRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      name: nullableString(row.name),
      amount: nullableNumber(row.amount),
      loss_reason: nullableString(row.loss_reason),
      competitor: nullableString(row.competitor),
      company_id: nullableString(row.company_id),
      expected_close_on: nullableString(row.expected_close_on),
      updated_at: nullableString(row.updated_at),
    }];
  });
}

export function normalizeDecisionRoomRecentLossRows(rows: unknown): DecisionRoomRecentLossRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];

    return [{
      id: row.id,
      name: nullableString(row.name),
      amount: nullableNumber(row.amount),
      loss_reason: nullableString(row.loss_reason),
      competitor: nullableString(row.competitor),
      updated_at: nullableString(row.updated_at),
    }];
  });
}
