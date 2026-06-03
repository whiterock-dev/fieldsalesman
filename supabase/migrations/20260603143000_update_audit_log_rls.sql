-- Drop the old overly-restrictive policy
DROP POLICY IF EXISTS "Admins can view all edit logs" ON customer_edit_log;

-- Allow Owners, Sub-admins, and Super Salesmen to view all edit logs
CREATE POLICY "Admins and super_salesman can view all edit logs" ON customer_edit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid()::text 
      AND profiles.role IN ('owner', 'sub_admin', 'super_salesman')
    )
  );

-- Allow regular Salesmen to view edit logs ONLY for their assigned customers
CREATE POLICY "Salesman can view logs for their assigned customers" ON customer_edit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers
      WHERE customers.id = customer_edit_log.customer_id
      AND customers.assigned_salesman_id = auth.uid()::text
    )
  );
