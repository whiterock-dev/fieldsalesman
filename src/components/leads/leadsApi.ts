import { supabase } from '../../lib/supabase';
import type { LeadRecord, LeadStatus } from './types';

export async function fetchLeads() {
  const { data, error } = await supabase!
    .from('leads')
    .select('*, followups(due_date)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching leads:', error);
    throw error;
  }
  return data as LeadRecord[];
}

export async function createLead(lead: Partial<LeadRecord>) {
  const { data, error } = await supabase!
    .from('leads')
    .insert(lead)
    .select()
    .single();

  if (error) {
    console.error('Error creating lead:', error);
    throw error;
  }
  return data as LeadRecord;
}

export async function updateLeadStatus(
  id: string, 
  status: LeadStatus, 
  updates: Partial<LeadRecord>
) {
  const { data, error } = await supabase!
    .from('leads')
    .update({ status, ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating lead status:', error);
    throw error;
  }

  if (status === 'won' && updates.order_value !== undefined) {
    try {
      const { data: customer, error: custError } = await supabase!
        .from('customers')
        .select('achievement')
        .eq('id', data.customer_id)
        .single();
        
      if (!custError && customer) {
        const dateStr = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
        const newEntry = `₹${updates.order_value}\n${dateStr}`;
        const updatedAchievement = customer.achievement 
          ? `${customer.achievement}\n\n${newEntry}`
          : newEntry;
          
        await supabase!
          .from('customers')
          .update({ achievement: updatedAchievement })
          .eq('id', data.customer_id);
      }
    } catch (err) {
      console.error('Error updating customer achievement:', err);
    }
  }

  return data as LeadRecord;
}

export async function checkOpenLead(customerId: string) {
  const { data, error } = await supabase!
    .from('leads')
    .select('id, created_at, salesman_id')
    .eq('customer_id', customerId)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error checking open lead:', error);
    throw error;
  }
  return data;
}

export async function updateAdminReviewRemarks(id: string, remarks: string) {
  const { data, error } = await supabase!
    .from('leads')
    .update({ admin_review_remarks: remarks, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating admin remarks:', error);
    throw error;
  }
  return data as LeadRecord;
}

export async function markAdminReviewAsRead(id: string) {
  const { data, error } = await supabase!
    .from('leads')
    .update({ admin_review_read: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error marking admin review as read:', error);
    throw error;
  }
  return data as LeadRecord;
}
