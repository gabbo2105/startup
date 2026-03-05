-- ============================================
-- Chat Messages: storico conversazioni AI
--
-- Tabella per persistere le conversazioni tra
-- utenti e l'assistente AI. Supporta tool calls
-- OpenAI e tracking token usage.
-- Visibile da admin panel per monitoring.
-- ============================================

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text,
  tool_calls jsonb,
  tool_call_id text,
  tool_name text,
  model text,
  tokens_prompt integer,
  tokens_completion integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Query principale: ultimi N messaggi per sessione
CREATE INDEX idx_chat_messages_session
  ON chat_messages(customer_id, session_id, created_at DESC);

-- Admin: tutte le chat di un cliente
CREATE INDEX idx_chat_messages_customer
  ON chat_messages(customer_id, created_at DESC);

-- =====================
-- RLS
-- =====================
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Utenti vedono solo i propri messaggi
CREATE POLICY "chat_messages_select_own" ON chat_messages
  FOR SELECT
  USING (
    customer_id IN (
      SELECT id FROM customers WHERE auth_user_id = (select auth.uid())
    )
  );

-- Utenti possono inserire solo propri messaggi
CREATE POLICY "chat_messages_insert_own" ON chat_messages
  FOR INSERT
  WITH CHECK (
    customer_id IN (
      SELECT id FROM customers WHERE auth_user_id = (select auth.uid())
    )
  );

-- Admin accesso completo
CREATE POLICY "chat_messages_admin" ON chat_messages
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
