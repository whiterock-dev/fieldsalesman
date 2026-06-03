-- Add updated_at to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Create trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_customer_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_updated_at ON customers;
CREATE TRIGGER trg_customer_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_updated_at();

-- Create audit log table
CREATE TABLE IF NOT EXISTS customer_edit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  edited_by text NOT NULL REFERENCES profiles(id),
  edited_at timestamptz NOT NULL DEFAULT now(),
  changed_fields jsonb NOT NULL DEFAULT '{}'
);

-- Index for fast lookups per customer
CREATE INDEX IF NOT EXISTS idx_customer_edit_log_customer ON customer_edit_log(customer_id, edited_at DESC);

-- Enable RLS on audit log
ALTER TABLE customer_edit_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all audit logs
CREATE POLICY "Admins can view all edit logs" ON customer_edit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid()::text 
      AND profiles.role IN ('owner', 'sub_admin')
    )
  );

-- Everyone can insert audit logs (when they edit)
CREATE POLICY "Users can insert edit logs" ON customer_edit_log
  FOR INSERT WITH CHECK (auth.uid()::text = edited_by);

-- Enable realtime for the audit table
ALTER PUBLICATION supabase_realtime ADD TABLE customer_edit_log;
