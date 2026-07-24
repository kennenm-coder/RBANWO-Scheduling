import { parse } from "csv-parse/sync";
import { RForceOrder, PhoneEntry } from "./types";
import { buildSalesforceUrl } from "./salesforce";

const COL = {
  RECORD_STATUS: 0,
  ORDER_NUMBER: 1,
  WORK_ORDER_NUMBER: 2,
  ADDRESS: 3,
  BOOKING_DATE: 4,
  CUSTOMER_NAME: 5,
  ORDER_OWNER: 6,
  SALES_REP: 7,
  TECH_MEASURE: 8,
  INSTALLER: 9,
  SERVICE_REP: 10,
  PRIMARY_RESOURCE: 11,
  APPOINTMENT_STATUS: 12,
  SCHEDULED_START: 13,
  SCHEDULED_END: 14,
  CONTACT_NAME: 15,
  EMAIL: 16,
  MOBILE_PHONE: 17,
  HOME_PHONE: 18,
  BUSINESS_PHONE: 19,
  SERVICE_DESCRIPTION: 20,
  WORK_ORDER_TYPE: 21,
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
  mobile: string,
  home: string,
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
      status: val(row, COL.RECORD_STATUS),
      appointment_status:
        val(row, COL.APPOINTMENT_STATUS) || val(row, COL.RECORD_STATUS),
      customer_name: val(row, COL.CUSTOMER_NAME),
      address: val(row, COL.ADDRESS),
      booking_date: parseDate(val(row, COL.BOOKING_DATE)),
      scheduled_start: parseDate(val(row, COL.SCHEDULED_START)),
      scheduled_end: parseDate(val(row, COL.SCHEDULED_END)),
      work_order_type: val(row, COL.WORK_ORDER_TYPE) || "Install",
      order_owner: val(row, COL.ORDER_OWNER),
      sales_rep: val(row, COL.SALES_REP),
      installer: val(row, COL.INSTALLER),
      contact_name: val(row, COL.CONTACT_NAME),
      email: val(row, COL.EMAIL),
      phones: deduplicatePhones(
        val(row, COL.MOBILE_PHONE),
        val(row, COL.HOME_PHONE),
        val(row, COL.BUSINESS_PHONE)
      ),
      product_count: null,
      csv_import_id: null,
    });
  }

  return orders;
}
