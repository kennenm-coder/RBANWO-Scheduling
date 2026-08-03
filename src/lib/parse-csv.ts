import { parse } from "csv-parse/sync";
import { RForceOrder, PhoneEntry } from "./types";

// Column indices matching the unified CSV report (30 columns)
// Note: two columns are both named "Status" — col 0 is Order Status, col 12 is WO/Appt Status
// Also two "Description" columns at 22 and 23
const COL = {
  ORDER_STATUS: 0,
  ORDER_NUMBER: 1,
  WORK_ORDER_NUMBER: 2,
  ADDRESS: 3,
  BOOKING_DATE: 4,
  CONTACT_NAME: 5,
  ORDER_OWNER: 6,
  SALES_REP: 7,
  TECH_MEASURE_NAME: 8,
  INSTALLER_NAME: 9,
  SERVICE_NAME: 10,
  PRIMARY_RESOURCE: 11,
  WO_STATUS: 12,
  SCHEDULED_START: 13,
  SCHEDULED_END: 14,
  CONTACT_NAME_2: 15,
  EMAIL: 16,
  MOBILE_PHONE: 17,
  HOME_PHONE: 18,
  BUSINESS_PHONE: 19,
  SERVICE_DESCRIPTION: 20,
  WORK_ORDER_TYPE: 21,
  DESCRIPTION_1: 22,
  DESCRIPTION_2: 23,
  COMBINED_RETAIL_TOTAL: 24,
  PRODUCT_COUNT: 25,
  TOTAL_UNITS: 26,
  WINDOWS: 27,
  PATIO_DOORS: 28,
  DOORS: 29,
} as const;

function val(row: string[], col: number): string {
  return (row[col] ?? "").trim();
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseNum(raw: string): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function parseIntVal(raw: string): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

function normalizePhone(raw: string): string {
  if (!raw) return "";
  return raw.replace(/[\s\-\(\)\.]/g, "");
}

function formatPhone(digits: string): string {
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return digits;
}

function deduplicatePhones(
  home: string,
  mobile: string,
  business: string
): PhoneEntry[] {
  const seen = new Set<string>();
  const phones: PhoneEntry[] = [];
  const entries: [string, string][] = [
    ["Mobile", mobile],
    ["Home", home],
    ["Business", business],
  ];
  for (const [label, raw] of entries) {
    const normalized = normalizePhone(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    phones.push({ label, number: formatPhone(normalized) });
  }
  return phones;
}

function validateHeaders(headerRow: string[]): boolean {
  const h = headerRow.map((s) => s.trim().toLowerCase());
  return h.includes("order number") && h.includes("work order number");
}

export function parseCsv(csvText: string): Omit<RForceOrder, "updated_at">[] {
  const cleaned = csvText.replace(/^﻿/, "");

  let records: string[][];
  try {
    records = parse(cleaned, {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
    });
  } catch {
    return [];
  }

  if (records.length < 2) return [];

  const headers = records[0];
  if (!validateHeaders(headers)) return [];

  const dataRows = records.slice(1);
  const orders: Omit<RForceOrder, "updated_at">[] = [];

  for (const row of dataRows) {
    const woNum = val(row, COL.WORK_ORDER_NUMBER);
    if (!woNum) continue;

    orders.push({
      id: woNum,
      order_number: val(row, COL.ORDER_NUMBER),
      work_order_number: woNum,
      order_status: val(row, COL.ORDER_STATUS),
      wo_status: val(row, COL.WO_STATUS),
      work_order_type: val(row, COL.WORK_ORDER_TYPE) || null,
      customer_name: val(row, COL.CONTACT_NAME) || val(row, COL.CONTACT_NAME_2) || null,
      address: val(row, COL.ADDRESS) || null,
      booking_date: parseDate(val(row, COL.BOOKING_DATE)),
      scheduled_start: parseDate(val(row, COL.SCHEDULED_START)),
      scheduled_end: parseDate(val(row, COL.SCHEDULED_END)),
      description: val(row, COL.DESCRIPTION_2) || val(row, COL.DESCRIPTION_1) || null,
      combined_retail_total: parseNum(val(row, COL.COMBINED_RETAIL_TOTAL)),
      product_count: parseIntVal(val(row, COL.PRODUCT_COUNT)),
      total_units: parseIntVal(val(row, COL.TOTAL_UNITS)),
      windows: parseIntVal(val(row, COL.WINDOWS)),
      patio_doors: parseIntVal(val(row, COL.PATIO_DOORS)),
      doors: parseIntVal(val(row, COL.DOORS)),
      order_owner: val(row, COL.ORDER_OWNER) || null,
      sales_rep: val(row, COL.SALES_REP) || null,
      primary_resource: val(row, COL.PRIMARY_RESOURCE) || null,
      tech_measure_name: val(row, COL.TECH_MEASURE_NAME) || null,
      installer: val(row, COL.INSTALLER_NAME) || null,
      service_rep: val(row, COL.SERVICE_NAME) || null,
      contact_name: val(row, COL.CONTACT_NAME) || val(row, COL.CONTACT_NAME_2) || null,
      email: val(row, COL.EMAIL) || null,
      phones: deduplicatePhones(
        val(row, COL.HOME_PHONE),
        val(row, COL.MOBILE_PHONE),
        val(row, COL.BUSINESS_PHONE)
      ),
      csv_import_id: null,
    });
  }

  return orders;
}
