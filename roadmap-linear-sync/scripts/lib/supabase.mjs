// scripts/lib/supabase.mjs
// Tiny Supabase REST/RPC wrapper. No supabase-js dependency.
// All requests use the service role key, so RLS is bypassed.
// QEP edition: targets qep_roadmap_tasks.

export class SupabaseError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.body = body;
  }
}

function uniqueNonEmpty(values = []) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function quotePostgrestInValue(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function setInFilter(params, column, values) {
  const normalized = uniqueNonEmpty(values);
  if (normalized.length === 0) return;
  params.set(column, `in.(${normalized.map(quotePostgrestInValue).join(',')})`);
}

export function buildPendingLinearSyncQuery({ taskIds = [], linearIssueIdentifiers = [] } = {}) {
  const params = new URLSearchParams();
  params.set('select', '*');
  setInFilter(params, 'task_id', taskIds);
  setInFilter(params, 'linear_issue_identifier', linearIssueIdentifiers);
  return params.toString();
}

export function hasLinearSyncScope({ taskIds = [], linearIssueIdentifiers = [] } = {}) {
  return uniqueNonEmpty(taskIds).length > 0 || uniqueNonEmpty(linearIssueIdentifiers).length > 0;
}

export function buildTargetedRoadmapTasksQuery({ taskIds = [], linearIssueIdentifiers = [] } = {}) {
  const params = new URLSearchParams();
  params.set('select', '*');
  setInFilter(params, 'task_id', taskIds);
  setInFilter(params, 'linear_issue_identifier', linearIssueIdentifiers);
  params.set('order', 'updated_at.asc,task_id.asc');
  return params.toString();
}

export class SupabaseClient {
  constructor({ url, serviceRoleKey }) {
    if (!url) throw new Error('SUPABASE_URL required');
    if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');
    this.url = url.replace(/\/$/, '');
    this.key = serviceRoleKey;
  }

  get headers() {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
  }

  async select(path, { query = '', limit, signal } = {}) {
    let url = `${this.url}/rest/v1/${path}`;
    const params = new URLSearchParams(query);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    if (qs) url += `?${qs}`;
    const res = await fetch(url, { headers: this.headers, signal });
    if (!res.ok) {
      throw new SupabaseError(`GET ${path} -> ${res.status}`, { status: res.status, body: await res.text() });
    }
    return res.json();
  }

  async patch(path, body, { query = '' } = {}) {
    let url = `${this.url}/rest/v1/${path}`;
    if (query) url += `?${query}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new SupabaseError(`PATCH ${path} -> ${res.status}`, { status: res.status, body: await res.text() });
    }
    return res.json();
  }

  // ---- QEP roadmap-specific helpers ---------------------------------------

  async listAllRoadmapTasks() {
    const rows = [];
    let from = 0;
    const pageSize = 500;
    while (true) {
      const page = await this.select('qep_roadmap_tasks', {
        query: `select=*&order=sort_order.asc,task_id.asc&offset=${from}&limit=${pageSize}`,
      });
      rows.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  }

  async listPendingLinearSync(limit = 250, filters = {}) {
    return this.select('v_qep_roadmap_tasks_pending_linear_sync', {
      query: buildPendingLinearSyncQuery(filters),
      limit,
    });
  }

  async listTargetedRoadmapTasksForLinearSync(limit = 250, filters = {}) {
    if (!hasLinearSyncScope(filters)) {
      throw new Error('Forced Linear sync requires --task-ids or --linear-issue-identifiers.');
    }
    return this.select('qep_roadmap_tasks', {
      query: buildTargetedRoadmapTasksQuery(filters),
      limit,
    });
  }

  async markLinearSynced(id, { linear_issue_id, linear_issue_identifier, linear_url }) {
    return this.patch('qep_roadmap_tasks', {
      linear_issue_id,
      linear_issue_identifier,
      linear_url,
      linear_synced_at: new Date().toISOString(),
      linear_sync_status: 'synced',
      linear_sync_error: null,
      linear_sync_attempt_count: 0,
    }, { query: `id=eq.${id}` });
  }

  async markLinearError(id, errorMessage, currentAttempt = 0) {
    return this.patch('qep_roadmap_tasks', {
      linear_sync_status: 'error',
      linear_sync_error: String(errorMessage).slice(0, 2000),
      linear_sync_attempt_count: currentAttempt + 1,
    }, { query: `id=eq.${id}` });
  }
}
