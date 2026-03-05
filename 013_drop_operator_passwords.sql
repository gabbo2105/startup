-- ============================================
-- SECURITY: Drop operator_passwords table
--
-- This table was created via dashboard and likely
-- contains plaintext passwords. It is not referenced
-- by any application code.
-- ============================================

DROP TABLE IF EXISTS operator_passwords;
