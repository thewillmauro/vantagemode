
ALTER TABLE public.leads 
  ADD COLUMN IF NOT EXISTS service text,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS timeline text;
