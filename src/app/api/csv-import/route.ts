import { NextRequest, NextResponse } from "next/server";
import { parseCsv } from "@/lib/parse-csv";
import { createCsvImport, upsertRForceOrders } from "@/lib/store";
import { geocodeBatch } from "@/lib/geocode";

export async function POST(req: NextRequest) {
  const apiKey = process.env.UPLOAD_API_KEY;
  if (apiKey && apiKey !== "changeme") {
    const provided = req.headers.get("x-api-key");
    if (provided !== apiKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let csvText = "";
  let filename = "upload.csv";
  let source: "power_automate" | "manual_upload" = "manual_upload";

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json();
    if (body.content) {
      csvText = Buffer.from(body.content, "base64").toString("utf-8");
      filename = body.filename || "power-automate.csv";
      source = "power_automate";
    }
  } else if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (file) {
      csvText = await file.text();
      filename = file.name;
    }
  } else {
    csvText = await req.text();
  }

  if (!csvText.trim()) {
    return NextResponse.json(
      { error: "No CSV data provided" },
      { status: 400 }
    );
  }

  const orders = parseCsv(csvText);
  if (orders.length === 0) {
    return NextResponse.json(
      { error: "No valid records found in CSV" },
      { status: 400 }
    );
  }

  const importRecord = await createCsvImport({
    filename,
    row_count: orders.length,
    source,
    imported_by: null,
  });

  if (!importRecord) {
    return NextResponse.json(
      { error: "Failed to create import record" },
      { status: 500 }
    );
  }

  const upserted = await upsertRForceOrders(orders, importRecord.id);

  const addresses = [...new Set(orders.map((o) => o.address).filter(Boolean) as string[])];
  if (addresses.length > 0) {
    geocodeBatch(addresses).catch(() => {});
  }

  return NextResponse.json({
    success: true,
    count: upserted,
    importId: importRecord.id,
    filename,
  });
}
