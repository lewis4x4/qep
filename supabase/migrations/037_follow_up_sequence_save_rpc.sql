-- Save follow-up sequences and step sets atomically.

create or replace function public.save_follow_up_sequence(
  p_sequence_id uuid,
  p_name text,
  p_description text,
  p_trigger_stage text,
  p_is_active boolean,
  p_actor_user_id uuid,
  p_steps jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sequence public.follow_up_sequences%rowtype;
  v_step jsonb;
  v_index integer := 0;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'VALIDATION_SEQUENCE_NAME_REQUIRED';
  end if;

  if coalesce(trim(p_trigger_stage), '') = '' then
    raise exception 'VALIDATION_SEQUENCE_TRIGGER_REQUIRED';
  end if;

  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 then
    raise exception 'VALIDATION_SEQUENCE_STEPS_REQUIRED';
  end if;

  if p_sequence_id is null then
    insert into public.follow_up_sequences (
      name,
      description,
      trigger_stage,
      is_active,
      created_by
    )
    values (
      trim(p_name),
      nullif(trim(coalesce(p_description, '')), ''),
      trim(p_trigger_stage),
      p_is_active,
      p_actor_user_id
    )
    returning * into v_sequence;
  else
    update public.follow_up_sequences
    set
      name = trim(p_name),
      description = nullif(trim(coalesce(p_description, '')), ''),
      trigger_stage = trim(p_trigger_stage),
      is_active = p_is_active
    where id = p_sequence_id
    returning * into v_sequence;

    if not found then
      raise exception 'NOT_FOUND';
    end if;
  end if;

  delete from public.follow_up_steps
  where sequence_id = v_sequence.id;

  for v_step in
    select value
    from jsonb_array_elements(p_steps)
  loop
    v_index := v_index + 1;

    insert into public.follow_up_steps (
      sequence_id,
      step_number,
      day_offset,
      step_type,
      subject,
      body_template,
      task_priority
    )
    values (
      v_sequence.id,
      v_index,
      coalesce((v_step ->> 'dayOffset')::integer, 0),
      (v_step ->> 'stepType')::public.followup_step_type,
      nullif(trim(coalesce(v_step ->> 'subject', '')), ''),
      nullif(trim(coalesce(v_step ->> 'bodyTemplate', '')), ''),
      nullif(trim(coalesce(v_step ->> 'taskPriority', '')), '')
    );
  end loop;

  return jsonb_build_object(
    'id', v_sequence.id,
    'name', v_sequence.name,
    'description', v_sequence.description,
    'triggerStage', v_sequence.trigger_stage,
    'isActive', v_sequence.is_active,
    'createdBy', v_sequence.created_by,
    'createdAt', v_sequence.created_at,
    'updatedAt', v_sequence.updated_at,
    'steps',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'sequenceId', s.sequence_id,
              'stepNumber', s.step_number,
              'dayOffset', s.day_offset,
              'stepType', s.step_type,
              'subject', s.subject,
              'bodyTemplate', s.body_template,
              'taskPriority', s.task_priority,
              'createdAt', s.created_at
            )
            order by s.step_number
          )
          from public.follow_up_steps s
          where s.sequence_id = v_sequence.id
        ),
        '[]'::jsonb
      )
  );
end;
$$;

-- Rollback (do not execute -- reference only)
-- drop function if exists public.save_follow_up_sequence(uuid, text, text, text, boolean, uuid, jsonb);
