export type CrewType =
  | "measure_tech"
  | "install_in_house"
  | "install_sub"
  | "jip"
  | "svc"
  | "second"
  | "management"
  | "misc";

export type AppointmentType =
  | "tech_measure"
  | "install"
  | "service"
  | "jip"
  | "lswp"
  | "hoa"
  | "paint_stain";

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "in_progress"
  | "complete"
  | "cancelled"
  | "rescheduled"
  | "unscheduled";

export type AppointmentOrigin = "manual" | "rforce_approved" | "merged";

export type SyncState =
  | "manual_awaiting_rforce"
  | "match_suggested"
  | "linked_pending_confirmation"
  | "waiting_for_import"
  | "in_sync"
  | "source_missing"
  | "ambiguous_match"
  | "conflict";

export interface OriginalEntrySnapshot {
  customer_name: string;
  address: string;
  scheduled_date: string | null;
  crew_id: string | null;
  time_block: TimeBlock | null;
  start_time: string | null;
  notes: string | null;
  appointment_type: AppointmentType;
  captured_at: string;
}

export type TimeBlock =
  | "9-10"
  | "10-12"
  | "12-2"
  | "2-4"
  | "4-6"
  | "full_day";

export type ManagesType = "install" | "service" | "jip" | "measure";

export interface Crew {
  id: string;
  name: string;
  crew_type: CrewType;
  color: string;
  is_active: boolean;
  notes: string | null;
  aliases: string[] | null;
  manages: ManagesType[] | null;
  additional_types: CrewType[] | null;
  primary_crew_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  crew_id: string | null;           // null when status='unscheduled'
  secondary_crew_id: string | null;
  tertiary_crew_id: string | null;
  appointment_type: AppointmentType;
  order_number: string | null;
  work_order_number: string | null;
  customer_name: string;
  address: string;
  scheduled_date: string | null;     // null when status='unscheduled'
  start_time: string | null;         // null when status='unscheduled'
  end_time: string | null;           // null when status='unscheduled'
  duration_days: number;
  time_block: TimeBlock | null;
  time_block_end?: TimeBlock | null;
  manual_override?: boolean;
  override_source?: { crew_name?: string; scheduled_date?: string; time_block?: string } | null;
  /** When true, this appointment is excluded from the double-booking unique index
   *  (an intentional same-slot overlap approved via the conflict-override flow). */
  allow_overlap?: boolean;
  /** When true, the scheduler knowingly booked this appointment onto a blocked
   *  availability window (PTO / Unavailable / Late Day / Office Day). Suppresses
   *  the availability_conflict flag for this intentional override. */
  allow_availability_conflict?: boolean;
  status: AppointmentStatus;
  notes: string | null;
  reschedule_reason: string | null;
  product_count: number | null;
  salesforce_url: string | null;
  scheduled_by: string | null;
  merge_source_wo: string | null;
  // ── Sync model (Phase 2a) ──
  origin: AppointmentOrigin;
  sync_state: SyncState;
  original_entry_snapshot: OriginalEntrySnapshot | null;
  last_reconciled_import_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RForceOrder {
  id: string;
  order_number: string;
  work_order_number: string;
  order_status: string | null;
  wo_status: string | null;
  work_order_type: string | null;
  customer_name: string | null;
  address: string | null;
  booking_date: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  description: string | null;
  combined_retail_total: number | null;
  product_count: number | null;
  total_units: number | null;
  windows: number | null;
  patio_doors: number | null;
  doors: number | null;
  order_owner: string | null;
  sales_rep: string | null;
  primary_resource: string | null;
  tech_measure_name: string | null;
  installer: string | null;
  service_rep: string | null;
  contact_name: string | null;
  email: string | null;
  phones: PhoneEntry[] | null;
  order_alerts: string | null;
  scheduler_notes: string | null;
  account_name: string | null;
  csv_import_id: string | null;
  latitude: number | null;
  longitude: number | null;
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
  content_hash: string | null;
  order_count: number | null;
  changed_count: number | null;
  new_count: number | null;
}

export interface ImportSnapshot {
  id: string;
  import_id: string;
  work_order_number: string;
  snapshot: Record<string, unknown>;
  change_summary: Record<string, { old: unknown; new: unknown }> | null;
  created_at: string;
}

export interface MatchRejection {
  id: string;
  appointment_id: string;
  work_order_number: string;
  rejected_by: string | null;
  rejected_at: string;
  reason: string | null;
}

export type ReconciliationStatus =
  | "unscheduled"
  | "scheduled_rforce_only"
  | "scheduled_app_only"
  | "scheduled_both"
  | "discrepancy"
  | "manual_override"
  | "completed"
  | "cancelled"
  | "not_in_rforce";

export interface ReconciliationDifferences {
  date?: { app: string; rforce: string };
  time?: { app: string; rforce: string };
  crew?: { app: string; rforce: string };
  type?: { app: string; rforce: string };
  /** Day-count of the job (rForce span vs scheduled duration_days). */
  duration?: { app: number; rforce: number };
}

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
  workOrderType?: string;
  orderStatus?: string;
  woStatus?: string;
  productCount?: number;
  windows?: number;
  patioDoors?: number;
  doors?: number;
  differences?: ReconciliationDifferences;
}

export type AppointmentEventAction =
  | "created"
  | "updated"
  | "rescheduled"
  | "cancelled"
  | "restored"
  | "helper_added"
  | "helper_removed"
  | "linked"
  | "flagged"
  | "drag_moved"
  | "drag_resized"
  | "approved_from_rforce"
  | "unscheduled"
  | "merged"
  | "sync_state_changed";

export interface AppointmentEvent {
  id: string;
  appointment_id: string;
  action: AppointmentEventAction;
  actor_id: string | null;
  actor_name_snapshot: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export type ViewMode = "day" | "week" | "block";

export interface TimeOffRequest {
  id: string;
  employee_name: string;
  department: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
}

export type AvailabilityKind =
  | "pto"
  | "unavailable"
  | "role_assignment"
  | "block"
  | "late_day"
  | "office_day";

export interface AvailabilityRule {
  id: string;
  crew_id: string;
  kind: AvailabilityKind;
  department: string | null;
  start_time: string | null;
  end_time: string | null;
  weekdays: number[];
  repeat_interval: number;
  effective_start: string;
  effective_end: string | null;
  reason: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityException {
  id: string;
  rule_id: string;
  exception_date: string;
  action: "skip" | "modify";
  override_start_time: string | null;
  override_end_time: string | null;
  reason: string | null;
  created_at: string;
}

export type LinkMatchMethod = "wo_exact" | "manual" | "auto" | "fuzzy";

export interface AppointmentLink {
  id: string;
  appointment_id: string;
  source_system: string;
  external_key: string;
  work_order_number: string | null;
  order_number: string | null;
  match_method: LinkMatchMethod;
  linked_by: string | null;
  linked_at: string;
  unlinked_by: string | null;
  unlinked_at: string | null;
  unlink_reason: string | null;
  created_at: string;
}

export interface ResourceMapping {
  id: string;
  raw_name: string;
  crew_id: string;
  is_active: boolean;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RForceDismissal {
  id: string;
  work_order_number: string;
  rforce_date: string;
  rforce_start_time: string | null;
  dismissed_by: string | null;
  dismissed_at: string;
  reason: string | null;
}

export interface FlagResolution {
  id: string;
  flag_key: string;
  resolved_by: string | null;
  resolved_at: string;
  notes: string | null;
}

// ── Flag System (three-class lifecycle) ──

export type FlagClass = "live_app" | "external_confirmation" | "workflow";

export type FlagState = "open" | "waiting_for_import" | "resolved" | "snoozed" | "superseded";

export type FlagCode =
  // Live app issues (auto-clear)
  | "double_booking"
  | "time_off_conflict"
  | "availability_conflict"
  | "invalid_resource_type"
  | "missing_crew"
  | "missing_scheduled_date"
  | "missing_time"
  | "invalid_time_range"
  | "overlapping_multi_block"
  | "missing_address"
  | "duplicate_app_appointment"
  // External confirmation issues
  | "date_mismatch"
  | "time_mismatch"
  | "resource_mismatch"
  | "type_mismatch"
  | "rforce_cancellation_mismatch"
  | "manual_override_active"
  // Workflow/data-integrity issues
  | "unlinked_appointment"
  | "duplicate_link"
  | "unmapped_resource"
  | "source_record_missing";

export type FlagSeverity = "error" | "warning" | "info";

export interface FlagFingerprint {
  appointmentId?: string;
  workOrderNumber?: string;
  flagCode: FlagCode;
  affectedField?: string;
  appValue?: string;
  importedValue?: string;
}

export interface SchedulingFlag {
  /** Stable identity: hash of fingerprint */
  id: string;
  /** The fingerprint components used to build the id */
  fingerprint: FlagFingerprint;
  /** Which of the three classes this flag belongs to */
  flagClass: FlagClass;
  /** Current lifecycle state */
  state: FlagState;
  /** The flag code (machine-readable type) */
  code: FlagCode;
  /** Severity for display */
  severity: FlagSeverity;
  /** Human-readable description of the issue */
  message: string;
  /** What action will resolve this flag */
  resolution: string;
  /** Whether this flag auto-clears (live_app) or needs acknowledgment (external/workflow) */
  autoClears: boolean;
  /** Whether a "waiting for import" checkbox is available */
  canAcknowledge: boolean;
  // ── Context ──
  appointmentId?: string;
  crewId?: string;
  date?: string;
  workOrderNumber?: string;
  /** For external confirmation: the difference details */
  differences?: FlagDifferences;
}

export interface FlagDifferences {
  date?: { app: string; rforce: string };
  time?: { app: string; rforce: string };
  crew?: { app: string; rforce: string };
  type?: { app: string; rforce: string };
}

export type RForceDisplayMode = "approval" | "discrepancy" | "synced" | "regular" | "merge_suggested";

export interface RForceDisplayItem {
  rforceOrder: RForceOrder;
  crewId: string;
  timeBlock: TimeBlock;
  displayMode: RForceDisplayMode;
  linkedAppointment?: Appointment;
  differences?: ReconciliationDifferences;
  fuzzyMatch?: FuzzyMatchCandidate;
  /** Order hasn't appeared in recent imports — likely cancelled/removed in rForce. */
  stale?: boolean;
}

// ── Fuzzy Matching ──

export type MatchConfidence = "high" | "medium";

export interface FuzzyMatchCandidate {
  appointment: Appointment;
  rforceOrder: RForceOrder;
  confidence: MatchConfidence;
  matchReasons: string[];
  score: number;
}

// ── Queue Pipeline ──

export type QueueItemCategory =
  | "needs_confirmation"
  | "merge_suggested"
  | "unscheduled"
  | "app_unscheduled"
  | "discrepancy"
  | "not_in_rforce";

export interface QueueItem {
  id: string;
  category: QueueItemCategory;
  rforceOrder?: RForceOrder;
  appointment?: Appointment;
  fuzzyMatch?: FuzzyMatchCandidate;
  customerName: string;
  address: string;
  workOrderNumber?: string;
  orderNumber?: string;
  workOrderType?: string;
  productCount?: number;
  // ── Normalized fields for filtering (populated by queue pipeline) ──
  normalizedWoType: string;        // Our AppointmentType key or "unknown"
  sourceWoType: string;            // Original rForce work_order_type string
  effectiveDate?: string;          // YYYY-MM-DD: rForce date for rForce items, app date for app items
  assignedResource?: string;       // primary_resource / tech_measure_name / installer / service_rep
  city: string;
  state: string;
  zip: string;
  orderStatus?: string;            // rForce order_status
  woStatus?: string;               // rForce wo_status
  appointmentStatus?: string;      // App appointment status
  windows?: number;
  patioDoors?: number;
  doors?: number;
  hasAlerts: boolean;
  hasSchedulerNotes: boolean;
  hasPossibleMerge: boolean;
  hasMissingInfo: boolean;         // Missing address, product count, or customer name
  schedulerNotes?: string;         // rForce scheduler_notes (for search)
}
