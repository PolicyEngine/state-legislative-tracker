-- Add manifold_url column to research table for prediction market links
ALTER TABLE research ADD COLUMN IF NOT EXISTS manifold_url TEXT;

COMMENT ON COLUMN research.manifold_url IS 'Manifold Markets prediction market URL for this bill';
