-- Migration 021: Add verifier_type, verdict, score_delta to verification_log
-- Extends the existing verification_log table with typed columns used by
-- the Phase 6a Verification Engine UI and the dedicated verifications endpoint.

ALTER TABLE verification_log
  ADD COLUMN IF NOT EXISTS verifier_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS verdict       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS score_delta   DECIMAL(8, 4);

-- Index on verifier_type for filtering by check category
CREATE INDEX IF NOT EXISTS idx_verify_verifier_type
  ON verification_log (signal_id, verifier_type);
