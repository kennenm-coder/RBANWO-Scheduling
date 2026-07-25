-- Migration: Update sched_rforce_orders to match real rForce report format
-- Run this in Supabase SQL Editor

-- Rename old status columns to be specific
ALTER TABLE sched_rforce_orders RENAME COLUMN status TO order_status;
ALTER TABLE sched_rforce_orders RENAME COLUMN appointment_status TO wo_status;

-- Add new product detail columns
ALTER TABLE sched_rforce_orders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE sched_rforce_orders ADD COLUMN IF NOT EXISTS combined_retail_total NUMERIC;
ALTER TABLE sched_rforce_orders ADD COLUMN IF NOT EXISTS total_units INTEGER;
ALTER TABLE sched_rforce_orders ADD COLUMN IF NOT EXISTS windows INTEGER;
ALTER TABLE sched_rforce_orders ADD COLUMN IF NOT EXISTS patio_doors INTEGER;
ALTER TABLE sched_rforce_orders ADD COLUMN IF NOT EXISTS doors INTEGER;

-- Add resource columns
ALTER TABLE sched_rforce_orders ADD COLUMN IF NOT EXISTS primary_resource TEXT;
ALTER TABLE sched_rforce_orders ADD COLUMN IF NOT EXISTS tech_measure_name TEXT;
ALTER TABLE sched_rforce_orders ADD COLUMN IF NOT EXISTS service_rep TEXT;

-- Update the appointment_type options to include new types
ALTER TABLE sched_appointments DROP CONSTRAINT IF EXISTS sched_appointments_appointment_type_check;
ALTER TABLE sched_appointments ADD CONSTRAINT sched_appointments_appointment_type_check
  CHECK (appointment_type IN (
    'tech_measure', 'install', 'service', 'jip',
    'lswp', 'hoa', 'paint_stain', 'job_site_visit', 'collections'
  ));
