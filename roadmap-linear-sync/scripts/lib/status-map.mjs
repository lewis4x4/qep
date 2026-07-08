// scripts/lib/status-map.mjs
// QEP-specific mapping. The unified roadmap uses a richer ship_state vocab
// because most QEP surfaces are already shipped — the active work is decisions
// and polish, not greenfield build.

// Linear workflow state TYPE values: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'triage'
//
// QEP ship_state -> Linear state resolution:
//   'not_started'      -> backlog
//   'in_progress'      -> started
//   'blocked'          -> named "Blocked" custom state (fallback unstarted)
//   'pending_decision' -> named "Pending Decision" custom state (fallback unstarted)
//   'shipped'          -> completed
//   'deferred'         -> named "Deferred" custom state (fallback canceled)
//   'na'               -> canceled

export const STATUS_TYPE_MAP = {
  not_started:      ['backlog', 'unstarted'],
  in_progress:      ['started'],
  blocked:          ['unstarted', 'backlog'],
  pending_decision: ['unstarted', 'backlog'],
  shipped:          ['completed'],
  deferred:         ['canceled', 'completed'],
  na:               ['canceled'],
};

// Named workflow states the QEP Linear team has configured.
// resolveStateId prefers a literal name match before falling back to type.
// Each ship_state has an ordered list of acceptable Linear state names — first
// match wins. This is forgiving across team configurations.
export const NAMED_STATES = {
  not_started:      ['Todo', 'Backlog'],
  in_progress:      ['In Progress', 'In Review'],
  blocked:          ['Blocked'],
  pending_decision: ['Decision', 'Pending Decision', 'Pending'],
  shipped:          ['Done', 'Completed'],
  deferred:         ['Deferred'],
  na:               ['Canceled', 'Cancelled'],
};

export function resolveStateId(shipState, workflowStates) {
  // Step 1: literal name match against the ordered preference list
  const candidateNames = NAMED_STATES[shipState] || [];
  for (const name of candidateNames) {
    const byName = workflowStates.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (byName) return byName.id;
  }

  // Step 2: fall back to type match
  const candidateTypes = STATUS_TYPE_MAP[shipState] || STATUS_TYPE_MAP.not_started;
  for (const t of candidateTypes) {
    const match = workflowStates.find(s => s.type === t);
    if (match) return match.id;
  }
  throw new Error(`No Linear workflow state matches QEP ship_state "${shipState}". Have: ${workflowStates.map(s => `${s.name}(${s.type})`).join(', ')}`);
}

// Stream code -> Linear project name
export const STREAM_PROJECT_NAMES = {
  A: 'Stream A — Iron Quote',
  B: 'Stream B — Sales-Advisor Field Platform',
  C: 'Stream C — IntelliDealer Cutover',
  D: 'Stream D — Parity Validation + Decision Resolution',
  E: 'Stream E — Platform Foundation',
  F: 'Stream F — Decision Velocity',
  G: 'Stream G — Parts Department',
  H: 'Stream H — Service Department',
  I: 'Stream I — Grapple-Truck Production',
  J: 'Stream J — Workforce',
  K: 'Stream K — Financials Re-architecture',
  L: 'Stream L — Rental Department',
  M: 'Stream M — Revenue Convergence',
  N: 'Stream N — Seam Completion',
};

// Standard label palette
export const STANDARD_LABEL_COLORS = {
  stream: '#3b82f6',           // blue
  wave: '#06b6d4',             // cyan
  owner: '#8b5cf6',            // violet
  blocking_decision: '#f97316',// orange
  blocked: '#ef4444',          // red
  pending_decision: '#eab308', // yellow
  deferred: '#64748b',         // slate
};

export function deriveLabelNamesFromTask(task) {
  const labels = [];
  if (task.stream)            labels.push(`stream:${task.stream}`);
  if (task.wave)              labels.push(`wave:${task.wave}`);
  if (task.owner)             labels.push(`owner:${task.owner}`);
  if (task.blocking_decision) labels.push(`blocker:${task.blocking_decision}`);
  if (task.ship_state === 'blocked')          labels.push('blocked');
  if (task.ship_state === 'pending_decision') labels.push('pending_decision');
  if (task.ship_state === 'deferred')         labels.push('deferred');
  return labels;
}

export function labelColorFor(name) {
  if (name.startsWith('stream:'))  return STANDARD_LABEL_COLORS.stream;
  if (name.startsWith('wave:'))    return STANDARD_LABEL_COLORS.wave;
  if (name.startsWith('owner:'))   return STANDARD_LABEL_COLORS.owner;
  if (name.startsWith('blocker:')) return STANDARD_LABEL_COLORS.blocking_decision;
  if (name === 'blocked')          return STANDARD_LABEL_COLORS.blocked;
  if (name === 'pending_decision') return STANDARD_LABEL_COLORS.pending_decision;
  if (name === 'deferred')         return STANDARD_LABEL_COLORS.deferred;
  return '#94a3b8'; // slate-400
}
