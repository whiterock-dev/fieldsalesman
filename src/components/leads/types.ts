export type LeadStatus = 'open' | 'won' | 'lost';

export type LeadRecord = {
  id: string;
  customer_id: string;
  salesman_id: string;
  requirement_description: string;
  status: LeadStatus;
  order_value?: number;
  closing_remarks?: string;
  lost_reason?: string;
  lost_remarks?: string;
  admin_review_remarks?: string;
  created_at: string;
  updated_at: string;
};

export type LeadWithDetails = LeadRecord & {
  customer_name: string;
  customer_firm: string;
  customer_city: string;
  customer_phone: string;
  salesman_name: string;
  next_followup_date?: string;
  overdue: boolean;
  due_today: boolean;
};
