-- Add a summary column to documents for AI-generated summaries on upload.

alter table public.documents
  add column if not exists summary text;

comment on column public.documents.summary is 'AI-generated 2-3 sentence summary of the document content.';
