-- ============================================================================
-- Add baseline_params to reform_impacts
-- The law each bill was compared with, so readers can see what it changed
-- ============================================================================
--
-- reform_params says what a bill sets; nothing recorded what it was set FROM.
-- For a bill still in the legislature that is today's law, but once a bill is
-- enacted, policyengine-us includes it and today's values equal the bill's —
-- the "before" is lost (GA HB 463: the prior-law 5.09% rate exists nowhere).
--
-- baseline_params has the same shape as reform_params,
--   {parameter_path: {"YYYY-MM-DD.YYYY-MM-DD": value}},
-- with each reform parameter's value under the baseline the run actually
-- used: current law, or the prior-law counterfactual (baseline_json) for an
-- enacted bill. compute_impacts.py writes it on every run;
-- scripts/backfill_baseline_params.py fills in rows scored before it existed.
--
-- Run this BEFORE deploying the compute_impacts.py change that writes it.

ALTER TABLE reform_impacts
  ADD COLUMN IF NOT EXISTS baseline_params JSONB;

COMMENT ON COLUMN reform_impacts.baseline_params IS
  'Each reform_params parameter''s value under the baseline the run used (current law, or the prior-law counterfactual for enacted bills); same shape as reform_params';
