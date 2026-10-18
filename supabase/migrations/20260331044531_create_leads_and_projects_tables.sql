
-- Leads table for contact form submissions
CREATE TABLE public.leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  company text,
  project_type text,
  budget text,
  message text,
  source text DEFAULT 'website',
  created_at timestamptz DEFAULT now()
);

-- Projects table for portfolio
CREATE TABLE public.projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  client text,
  category text NOT NULL,
  description text,
  thumbnail_url text,
  video_url text,
  tags text[],
  featured boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Leads: allow anonymous inserts (from the website form), no reads
CREATE POLICY "Allow anonymous inserts on leads"
  ON public.leads FOR INSERT
  TO anon
  WITH CHECK (true);

-- Projects: allow anonymous reads (public portfolio), no writes
CREATE POLICY "Allow anonymous reads on projects"
  ON public.projects FOR SELECT
  TO anon
  USING (true);
