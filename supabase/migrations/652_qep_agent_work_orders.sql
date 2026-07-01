-- ============================================================================
-- Migration 652: QEP agent work-order queue
-- Purpose: vendor-neutral queue contract for comment-driven Linear agents.
-- Source: QEP (1)/QEP_COMMENT_DRIVEN_AGENTS.md
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qep_agent_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL REFERENCES public.qep_roadmap_tasks(task_id) ON DELETE CASCADE,
  command text NOT NULL,
  argument text,
  requested_by text NOT NULL,
  requested_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  preferred_runner text NOT NULL DEFAULT 'claude_code',
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  source_issue_id text,
  source_issue_identifier text,
  source_comment_id text,
  source_comment_url text,
  source_comment_body text,
  runner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  iteration_count integer NOT NULL DEFAULT 0,
  max_iterations integer NOT NULL DEFAULT 5,
  budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qep_agent_work_orders_command_ck CHECK (command IN ('build','research','estimate','explain','split','answer','block','unblock','handoff','status')),
  CONSTRAINT qep_agent_work_orders_preferred_runner_ck CHECK (preferred_runner IN ('claude_code','cursor_background','repoprompt','github_action','manual')),
  CONSTRAINT qep_agent_work_orders_runner_ck CHECK (runner IS NULL OR runner IN ('claude_code','cursor_background','repoprompt','github_action','manual')),
  CONSTRAINT qep_agent_work_orders_status_ck CHECK (status IN ('queued','running','done','failed','cancelled','blocked','dead_letter')),
  CONSTRAINT qep_agent_work_orders_source_ck CHECK (source IN ('linear_comment','manual','orchestrator','decision_inbox','api')),
  CONSTRAINT qep_agent_work_orders_attempts_ck CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),
  CONSTRAINT qep_agent_work_orders_iterations_ck CHECK (iteration_count >= 0 AND max_iterations > 0 AND iteration_count <= max_iterations),
  CONSTRAINT qep_agent_work_orders_requested_by_ck CHECK (length(btrim(requested_by)) > 0),
  CONSTRAINT qep_agent_work_orders_running_lease_ck CHECK (status <> 'running' OR (runner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS qep_agent_work_orders_source_comment_uidx
  ON public.qep_agent_work_orders (source_comment_id)
  WHERE source_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS qep_agent_work_orders_task_idx
  ON public.qep_agent_work_orders (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qep_agent_work_orders_queue_idx
  ON public.qep_agent_work_orders (preferred_runner, status, priority DESC, created_at ASC)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS qep_agent_work_orders_lease_idx
  ON public.qep_agent_work_orders (lease_expires_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS qep_agent_work_orders_issue_idx
  ON public.qep_agent_work_orders (source_issue_id, created_at DESC)
  WHERE source_issue_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_qep_agent_work_orders_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qep_agent_work_orders_touch_updated_at ON public.qep_agent_work_orders;
CREATE TRIGGER qep_agent_work_orders_touch_updated_at
  BEFORE UPDATE ON public.qep_agent_work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_qep_agent_work_orders_touch_updated_at();

CREATE OR REPLACE FUNCTION public.fn_qep_agent_work_order_command(p_command text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_command text;
BEGIN
  v_command := lower(split_part(regexp_replace(btrim(COALESCE(p_command, '')), '^/+', ''), ' ', 1));
  IF v_command NOT IN ('build','research','estimate','explain','split','answer','block','unblock','handoff','status') THEN
    RAISE EXCEPTION 'unsupported qep agent command: %', p_command USING ERRCODE = '22023';
  END IF;
  RETURN v_command;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_qep_agent_work_order_default_runner(p_command text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_command text := public.fn_qep_agent_work_order_command(p_command);
BEGIN
  IF v_command IN ('answer', 'block') THEN
    RETURN 'github_action';
  END IF;
  IF v_command IN ('split') THEN
    RETURN 'repoprompt';
  END IF;
  RETURN 'claude_code';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_qep_agent_work_order_authorized()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.role() = 'service_role'
    OR public.get_my_role() IN ('admin', 'manager', 'owner')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_agent_service_account = true
    );
$$;

CREATE OR REPLACE FUNCTION public.enqueue_qep_agent_work_order(
  p_task_id text,
  p_command text,
  p_argument text DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_source_issue_id text DEFAULT NULL,
  p_source_issue_identifier text DEFAULT NULL,
  p_source_comment_id text DEFAULT NULL,
  p_source_comment_url text DEFAULT NULL,
  p_source_comment_body text DEFAULT NULL,
  p_requested_by text DEFAULT NULL,
  p_requested_by_user_id uuid DEFAULT NULL,
  p_preferred_runner text DEFAULT NULL,
  p_priority integer DEFAULT 0,
  p_max_iterations integer DEFAULT 5,
  p_max_attempts integer DEFAULT 3,
  p_budget jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.qep_agent_work_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task_id text := NULLIF(btrim(COALESCE(p_task_id, '')), '');
  v_command text := public.fn_qep_agent_work_order_command(p_command);
  v_source text := lower(NULLIF(btrim(COALESCE(p_source, '')), ''));
  v_runner text;
  v_requested_by text := COALESCE(NULLIF(btrim(COALESCE(p_requested_by, '')), ''), NULLIF(auth.jwt() ->> 'email', ''), 'qep-agent-work-order');
  v_source_comment_id text := NULLIF(btrim(COALESCE(p_source_comment_id, '')), '');
  v_existing public.qep_agent_work_orders%ROWTYPE;
  v_inserted public.qep_agent_work_orders%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND public.get_my_role() NOT IN ('admin', 'manager', 'owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_task_id IS NULL THEN RAISE EXCEPTION 'task_id is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.qep_roadmap_tasks t WHERE t.task_id = v_task_id) THEN
    RAISE EXCEPTION 'qep roadmap task % not found', v_task_id;
  END IF;
  v_source := COALESCE(v_source, 'manual');
  IF v_source NOT IN ('linear_comment','manual','orchestrator','decision_inbox','api') THEN
    RAISE EXCEPTION 'unsupported qep agent work-order source: %', p_source USING ERRCODE = '22023';
  END IF;
  v_runner := COALESCE(NULLIF(btrim(COALESCE(p_preferred_runner, '')), ''), public.fn_qep_agent_work_order_default_runner(v_command));
  IF v_runner NOT IN ('claude_code','cursor_background','repoprompt','github_action','manual') THEN
    RAISE EXCEPTION 'unsupported qep agent runner: %', v_runner USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_max_iterations, 0) <= 0 THEN RAISE EXCEPTION 'max_iterations must be greater than zero'; END IF;
  IF COALESCE(p_max_attempts, 0) <= 0 THEN RAISE EXCEPTION 'max_attempts must be greater than zero'; END IF;

  IF v_source_comment_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.qep_agent_work_orders WHERE source_comment_id = v_source_comment_id;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  INSERT INTO public.qep_agent_work_orders (
    task_id, command, argument, requested_by, requested_by_user_id,
    preferred_runner, priority, source, source_issue_id, source_issue_identifier,
    source_comment_id, source_comment_url, source_comment_body, max_iterations,
    max_attempts, budget, metadata
  )
  VALUES (
    v_task_id, v_command, NULLIF(p_argument, ''), v_requested_by, p_requested_by_user_id,
    v_runner, COALESCE(p_priority, 0), v_source, NULLIF(btrim(COALESCE(p_source_issue_id, '')), ''),
    NULLIF(btrim(COALESCE(p_source_issue_identifier, '')), ''), v_source_comment_id,
    NULLIF(btrim(COALESCE(p_source_comment_url, '')), ''), NULLIF(p_source_comment_body, ''),
    p_max_iterations, p_max_attempts, COALESCE(p_budget, '{}'::jsonb), COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_inserted;

  INSERT INTO public.qep_roadmap_sync_events (direction, task_id, linear_issue_id, action, changed_fields, webhook_id, actor)
  VALUES (
    CASE WHEN v_source = 'linear_comment' THEN 'linear_to_supabase' ELSE 'reconcile' END,
    v_inserted.task_id,
    v_inserted.source_issue_id,
    'create',
    jsonb_strip_nulls(jsonb_build_object(
      'reason', 'qep_agent_work_order_enqueued',
      'work_order_id', v_inserted.id,
      'command', v_inserted.command,
      'preferred_runner', v_inserted.preferred_runner,
      'source', v_inserted.source,
      'source_issue_identifier', v_inserted.source_issue_identifier,
      'source_comment_id', v_inserted.source_comment_id
    )),
    v_inserted.source_comment_id,
    v_inserted.requested_by
  );
  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_qep_agent_work_order(p_runner text, p_lease_seconds integer DEFAULT 600)
RETURNS public.qep_agent_work_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runner text := lower(NULLIF(btrim(COALESCE(p_runner, '')), ''));
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 600), 60), 3600);
  v_order public.qep_agent_work_orders%ROWTYPE;
BEGIN
  IF NOT public.fn_qep_agent_work_order_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_runner NOT IN ('claude_code','cursor_background','repoprompt','github_action','manual') THEN
    RAISE EXCEPTION 'unsupported qep agent runner: %', p_runner USING ERRCODE = '22023';
  END IF;

  WITH next_order AS (
    SELECT id
    FROM public.qep_agent_work_orders
    WHERE preferred_runner = v_runner
      AND attempt_count < max_attempts
      AND (status = 'queued' OR (status = 'running' AND lease_expires_at < now()))
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.qep_agent_work_orders wo
  SET status = 'running',
      runner = v_runner,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => v_lease_seconds),
      attempt_count = wo.attempt_count + 1,
      started_at = COALESCE(wo.started_at, now()),
      last_error = NULL
  FROM next_order
  WHERE wo.id = next_order.id
  RETURNING wo.* INTO v_order;
  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_qep_agent_work_order(
  p_work_order_id uuid,
  p_lease_token uuid,
  p_status text,
  p_result_summary text DEFAULT NULL,
  p_result jsonb DEFAULT '{}'::jsonb,
  p_error text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.qep_agent_work_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := lower(NULLIF(btrim(COALESCE(p_status, '')), ''));
  v_order public.qep_agent_work_orders%ROWTYPE;
BEGIN
  IF NOT public.fn_qep_agent_work_order_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_work_order_id IS NULL THEN RAISE EXCEPTION 'work_order_id is required'; END IF;
  IF p_lease_token IS NULL THEN RAISE EXCEPTION 'lease_token is required'; END IF;
  IF v_status NOT IN ('done','failed','cancelled','blocked','dead_letter') THEN
    RAISE EXCEPTION 'unsupported terminal qep agent work-order status: %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.qep_agent_work_orders
  SET status = v_status,
      lease_token = NULL,
      lease_expires_at = NULL,
      result_summary = NULLIF(p_result_summary, ''),
      result = COALESCE(p_result, '{}'::jsonb),
      last_error = NULLIF(p_error, ''),
      metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('finished_at', now()),
      completed_at = now()
  WHERE id = p_work_order_id
    AND lease_token = p_lease_token
    AND status = 'running'
  RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'running qep agent work order % with matching lease was not found', p_work_order_id;
  END IF;

  INSERT INTO public.qep_roadmap_sync_events (direction, task_id, linear_issue_id, action, changed_fields, webhook_id, actor)
  VALUES (
    'reconcile',
    v_order.task_id,
    v_order.source_issue_id,
    'update',
    jsonb_strip_nulls(jsonb_build_object(
      'reason', 'qep_agent_work_order_finished',
      'work_order_id', v_order.id,
      'command', v_order.command,
      'status', v_order.status,
      'runner', v_order.runner,
      'result_summary', v_order.result_summary
    )),
    v_order.source_comment_id,
    COALESCE(v_order.runner, 'qep-agent-runner')
  );
  RETURN v_order;
END;
$$;

ALTER TABLE public.qep_agent_work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qep_agent_work_orders_service_role_all ON public.qep_agent_work_orders;
CREATE POLICY qep_agent_work_orders_service_role_all ON public.qep_agent_work_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS qep_agent_work_orders_authenticated_read ON public.qep_agent_work_orders;
CREATE POLICY qep_agent_work_orders_authenticated_read ON public.qep_agent_work_orders
  FOR SELECT TO authenticated
  USING (
    (select public.get_my_role()) IN ('admin', 'manager', 'owner')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (select auth.uid()) AND p.is_agent_service_account = true)
  );

REVOKE ALL ON public.qep_agent_work_orders FROM anon;
REVOKE ALL ON public.qep_agent_work_orders FROM authenticated;
GRANT SELECT ON public.qep_agent_work_orders TO authenticated;
GRANT ALL ON public.qep_agent_work_orders TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_qep_agent_work_orders_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_qep_agent_work_order_command(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_qep_agent_work_order_default_runner(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_qep_agent_work_order_authorized() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_qep_agent_work_order(text,text,text,text,text,text,text,text,text,text,uuid,text,integer,integer,integer,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_qep_agent_work_order(text,text,text,text,text,text,text,text,text,text,uuid,text,integer,integer,integer,jsonb,jsonb) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_qep_agent_work_order(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_qep_agent_work_order(text, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.finish_qep_agent_work_order(uuid, uuid, text, text, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_qep_agent_work_order(uuid, uuid, text, text, jsonb, text, jsonb) TO authenticated, service_role;

COMMENT ON TABLE public.qep_agent_work_orders IS
  'Vendor-neutral queue for comment-driven QEP agent work. Linear/webhook inputs enqueue rows; runner adapters claim with leases.';
COMMENT ON COLUMN public.qep_agent_work_orders.preferred_runner IS
  'Router hint only. Keeps Linear decoupled from Claude Code, Cursor Background Agents, RepoPrompt, and GitHub Actions.';
COMMENT ON COLUMN public.qep_agent_work_orders.source_comment_id IS
  'Linear comment id used for idempotency; duplicate webhook deliveries return the original work order.';
COMMENT ON COLUMN public.qep_agent_work_orders.max_iterations IS
  'Cycle cap for autonomous runs. Prevents unbounded agent loops.';
COMMENT ON FUNCTION public.enqueue_qep_agent_work_order(text,text,text,text,text,text,text,text,text,text,uuid,text,integer,integer,integer,jsonb,jsonb) IS
  'Idempotently queues a QEP agent work order from Linear comments, orchestrator actions, APIs, or manual admin requests.';
COMMENT ON FUNCTION public.claim_qep_agent_work_order(text, integer) IS
  'Claims the next queued or expired QEP agent work order for a runner using FOR UPDATE SKIP LOCKED and a bounded lease.';
COMMENT ON FUNCTION public.finish_qep_agent_work_order(uuid, uuid, text, text, jsonb, text, jsonb) IS
  'Completes a running QEP agent work order only when the caller presents the active lease token.';

INSERT INTO public.qep_roadmap_tasks (
  task_id, stream, wave, title, description, ship_state, owner,
  blocking_decision, depends_on, evidence_link, notes, sort_order
)
VALUES
('F2.6','F','F2','Agent work-order queue',
 'Create qep_agent_work_orders as the vendor-neutral queue contract for comment-driven Linear commands. Webhooks enqueue; runner adapters claim leased rows; no runner vendor is wired directly to Linear.',
 'shipped','Engineer + Orchestrator',NULL,ARRAY['F2.3'],'supabase/migrations/652_qep_agent_work_orders.sql',
 '[2026-06-30] Queue contract added. Follow-ups: F2.7 dispatcher and F2.8 progress comments.',5206),
('F2.7','F','F2','Agent runner dispatcher',
 'Build the dispatcher that claims queued qep_agent_work_orders rows and kicks Claude Code /goal first, then Cursor Background Agents or RepoPrompt adapters as second-stage runners.',
 'not_started','Engineer + Orchestrator',NULL,ARRAY['F2.6'],'QEP (1)/QEP_COMMENT_DRIVEN_AGENTS.md',
 '[2026-06-30] Created as the next slice after the queue contract.',5207),
('F2.8','F','F2','Agent progress comments back to Linear',
 'Post runner checkpoints back to the Linear issue: started, clarification requested, tests green, PR opened, done/failed.',
 'not_started','Engineer + Orchestrator',NULL,ARRAY['F2.6','F2.7'],'QEP (1)/QEP_COMMENT_DRIVEN_AGENTS.md',
 '[2026-06-30] Created so Linear becomes the live console for work-order execution.',5208)
ON CONFLICT (task_id) DO UPDATE SET
  stream = EXCLUDED.stream,
  wave = EXCLUDED.wave,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  ship_state = EXCLUDED.ship_state,
  owner = EXCLUDED.owner,
  blocking_decision = EXCLUDED.blocking_decision,
  depends_on = EXCLUDED.depends_on,
  evidence_link = EXCLUDED.evidence_link,
  notes = CASE
    WHEN COALESCE(public.qep_roadmap_tasks.notes, '') LIKE '%' || EXCLUDED.notes || '%'
      THEN public.qep_roadmap_tasks.notes
    ELSE COALESCE(public.qep_roadmap_tasks.notes, '') || E'\n' || EXCLUDED.notes
  END,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

NOTIFY pgrst, 'reload schema';

COMMIT;
