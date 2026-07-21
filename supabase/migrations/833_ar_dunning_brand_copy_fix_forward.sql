-- Migration 833: replace the temporary AR dunning copy shipped in migration 828.
--
-- This is intentionally a fix-forward. Migration 828 has already been applied,
-- so its history must remain immutable. The function body is rewritten in place
-- from PostgreSQL's canonical definition so its OID, owner, grants, SECURITY
-- DEFINER flag, and search_path configuration remain unchanged.
--
-- Rollback posture: do not restore placeholder text. If copy must change again,
-- ship another forward migration with the replacement copy and evidence repair.

begin;

do $copy_fix$
declare
  v_function regprocedure := to_regprocedure(
    'public.run_ar_dunning_cycle(text,date)'
  );
  v_definition text;
  v_updated_definition text;
  v_generic_literal text := quote_literal('TODO: brand-voice');
  v_finance_literal text := quote_literal(
    'TODO: brand-voice finance charge'
  );
  v_copy text;
  v_position integer;
  v_generic_count integer;
  v_finance_count integer;
  v_owner oid;
  v_acl aclitem[];
  v_config text[];
  v_security_definer boolean;
  v_leakproof boolean;
  v_volatility "char";
  v_parallel "char";
begin
  if v_function is null then
    raise exception
      'migration 833 requires public.run_ar_dunning_cycle(text,date)';
  end if;

  select
    pg_get_functiondef(proc.oid),
    proc.proowner,
    proc.proacl,
    proc.proconfig,
    proc.prosecdef,
    proc.proleakproof,
    proc.provolatile,
    proc.proparallel
  into
    v_definition,
    v_owner,
    v_acl,
    v_config,
    v_security_definer,
    v_leakproof,
    v_volatility,
    v_parallel
  from pg_proc proc
  where proc.oid = v_function;

  if not v_security_definer then
    raise exception
      'run_ar_dunning_cycle must remain SECURITY DEFINER';
  end if;

  v_updated_definition := v_definition;

  if position('TODO: brand-voice' in v_updated_definition) > 0 then
    v_finance_count := (
      length(v_updated_definition)
      - length(replace(v_updated_definition, v_finance_literal, ''))
    ) / length(v_finance_literal);

    if v_finance_count <> 2 then
      raise exception
        'run_ar_dunning_cycle finance-copy shape drifted: expected 2 placeholders, found %',
        v_finance_count;
    end if;

    v_updated_definition := replace(
      v_updated_definition,
      v_finance_literal,
      quote_literal('Monthly finance charge')
    );

    v_generic_count := (
      length(v_updated_definition)
      - length(replace(v_updated_definition, v_generic_literal, ''))
    ) / length(v_generic_literal);

    if v_generic_count <> 4 then
      raise exception
        'run_ar_dunning_cycle event-copy shape drifted: expected 4 placeholders, found %',
        v_generic_count;
    end if;

    -- The four generic literals occur in the stable event order established by
    -- migration 828: statement, finance charge, reminder, then automatic hold.
    foreach v_copy in array array[
      'Account statement generated',
      'Monthly finance charge assessed',
      'Past-due payment reminder queued',
      'Credit hold applied for past-due balance'
    ]
    loop
      v_position := strpos(v_updated_definition, v_generic_literal);
      if v_position = 0 then
        raise exception
          'run_ar_dunning_cycle event-copy replacement ended early';
      end if;

      v_updated_definition := overlay(
        v_updated_definition
        placing quote_literal(v_copy)
        from v_position
        for length(v_generic_literal)
      );
    end loop;

    if position('TODO: brand-voice' in v_updated_definition) > 0 then
      raise exception
        'run_ar_dunning_cycle still contains temporary brand copy after rewrite';
    end if;

    execute v_updated_definition;
  end if;

  select pg_get_functiondef(proc.oid)
  into v_definition
  from pg_proc proc
  where proc.oid = v_function;

  if position('TODO: brand-voice' in v_definition) > 0 then
    raise exception
      'live run_ar_dunning_cycle definition retains temporary brand copy';
  end if;

  foreach v_copy in array array[
    'Account statement generated',
    'Monthly finance charge assessed',
    'Monthly finance charge',
    'Past-due payment reminder queued',
    'Credit hold applied for past-due balance'
  ]
  loop
    if position(quote_literal(v_copy) in v_definition) = 0 then
      raise exception
        'live run_ar_dunning_cycle definition is missing required copy: %',
        v_copy;
    end if;
  end loop;

  if exists (
    select 1
    from pg_proc proc
    where proc.oid = v_function
      and (
        proc.proowner is distinct from v_owner
        or proc.proacl is distinct from v_acl
        or proc.proconfig is distinct from v_config
        or proc.prosecdef is distinct from v_security_definer
        or proc.proleakproof is distinct from v_leakproof
        or proc.provolatile is distinct from v_volatility
        or proc.proparallel is distinct from v_parallel
      )
  ) then
    raise exception
      'run_ar_dunning_cycle ownership, grants, or security settings changed during copy repair';
  end if;
end;
$copy_fix$;

-- Repair every known placeholder row without assuming a workspace identifier.
-- The placeholder is an internal sentinel, so replacing it across tenants is
-- both deterministic and safer than leaving customer-visible temporary copy.
update public.ar_dunning_events
set message_stub = case event_type
  when 'statement' then 'Account statement generated'
  when 'finance_charge' then 'Monthly finance charge assessed'
  when 'reminder_email' then 'Past-due payment reminder queued'
  when 'auto_hold' then 'Credit hold applied for past-due balance'
  else 'Accounts receivable event recorded'
end
where position('TODO: brand-voice' in coalesce(message_stub, '')) > 0;

update public.customer_invoices
set description = 'Monthly finance charge'
where position('TODO: brand-voice' in coalesce(description, '')) > 0;

update public.customer_invoice_line_items
set description = 'Monthly finance charge'
where position('TODO: brand-voice' in coalesce(description, '')) > 0;

do $copy_assert$
begin
  if position(
    'TODO: brand-voice'
    in pg_get_functiondef(
      'public.run_ar_dunning_cycle(text,date)'::regprocedure
    )
  ) > 0 then
    raise exception
      'run_ar_dunning_cycle definition still contains temporary brand copy';
  end if;

  if exists (
    select 1
    from public.ar_dunning_events
    where position('TODO: brand-voice' in coalesce(message_stub, '')) > 0
  ) then
    raise exception 'AR dunning event copy repair is incomplete';
  end if;

  if exists (
    select 1
    from public.customer_invoices
    where position('TODO: brand-voice' in coalesce(description, '')) > 0
  ) then
    raise exception 'finance-charge invoice copy repair is incomplete';
  end if;

  if exists (
    select 1
    from public.customer_invoice_line_items
    where position('TODO: brand-voice' in coalesce(description, '')) > 0
  ) then
    raise exception 'finance-charge line copy repair is incomplete';
  end if;
end;
$copy_assert$;

commit;
