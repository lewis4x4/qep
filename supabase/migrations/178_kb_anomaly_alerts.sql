-- Extend anomaly alerts to cover KB health issues.

alter table public.anomaly_alerts
  drop constraint if exists anomaly_alerts_alert_type_check;

alter table public.anomaly_alerts
  add constraint anomaly_alerts_alert_type_check
  check (alert_type in (
    'stalling_deal',
    'overdue_follow_up',
    'pricing_anomaly',
    'utilization_drop',
    'pipeline_risk',
    'activity_gap',
    'embedding_stale',
    'orphan_chunks'
  ));

alter table public.anomaly_alerts
  drop constraint if exists anomaly_alerts_entity_type_check;

alter table public.anomaly_alerts
  add constraint anomaly_alerts_entity_type_check
  check (entity_type is null or entity_type in (
    'deal',
    'contact',
    'company',
    'equipment',
    'activity',
    'voice_capture',
    'document'
  ));
