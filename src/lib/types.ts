export type CrewType =
  | "measure_tech"
  | "install_in_house"
  | "install_sub"
  | "jip"
  | "svc";

export type AppointmentType = "tech_measure" | "install" | "service" | "jip";

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "in_progress"
  | "complete"
  | "cancelled"
  | "rescheduled";

export type TimeBlock =
  | "9-10"
  | "10-12"
  | "12-2"
  | "2-4"
  | "4-6"
  | "full_day";

export interface Crew {
  id: string;
  name: string;
  crew_type: CrewType;
  color: string;
  is_active: boolean;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  crew_id: string;
  secondary_crew_id: string | null;
  appointment_type: AppointmentType;
  order_number: string | null;
  work_order_number: string | null;
  customer_name: string;
  address: string;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  duration_days: number;
  time_block: TimeBlock | null;
  status: AppointmentStatus;
  notes: string | null;
  reschedule_reason: string | null;
  product_count: number | null;
  salesforce_url: string | null;
  scheduled_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RForceOrder {
  id: string;
  order_number: string;
  work_order_number: string;
  status: string | null;
  appointment_status: string | null;
  customer_name: string | null;
  address: string | null;
  booking_date: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  work_order_type: string | null;
  order_owner: string | null;
  sales_rep: string | null;
  installer: string | null;
  contact_name: string | null;
  email: string | null;
  phones: PhoneEntry[] | null;
  product_count: number | null;
  csv_import_id: string | null;
  updated_at: string;
}

export interface PhoneEntry {
  label: string;
  number: string;
}

export interface CsvImport {
  id: string;
  filename: string | null;
  row_count: number;
  source: "power_automate" | "manual_upload";
  imported_by: string | null;
  imported_at: string;
}

export type ReconciliationStatus =
  | "unscheduled"
  | "scheduled_app_only"
  | "scheduled_both"
  | "discrepancy"
  | "not_in_rforce";

export interface ReconciliationResult {
  orderNumber: string;
  workOrderNumber: string;
  status: ReconciliationStatus;
  appDate?: string;
  rforceDate?: string;
  appCrew?: string;
  rforceCrew?: string;
  customerName: string;
  address: string;
  salesforceUrl?: string;
}

export type ViewMode = "day" | "week";

export interface TimeOffRequest {
  id: string;
  employee_name: string;
  department: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
}
