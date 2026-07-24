"use client";

import { useState, useCallback } from "react";
import { useData } from "./DataProvider";
import { Upload, CheckCircle2, AlertCircle } from "lucide-react";

export default function CsvUploader() {
  const { refreshData } = useData();
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("uploading");
      setMessage("");

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/csv-import", {
          method: "POST",
          body: formData,
        });

        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.error || "Upload failed");
        }

        setStatus("success");
        setMessage(`Imported ${result.count} records from ${file.name}`);
        await refreshData();
      } catch (err: any) {
        setStatus("error");
        setMessage(err.message || "Upload failed");
      }
    },
    [refreshData]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold mb-3">Import CSV from rForce</h3>
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary hover:bg-primary-light/20 transition-colors cursor-pointer"
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".csv,.xls";
          input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) handleFile(file);
          };
          input.click();
        }}
      >
        <Upload size={32} className="mx-auto text-muted mb-2" />
        <p className="text-sm text-muted">
          {status === "uploading"
            ? "Uploading..."
            : "Drop CSV file here or click to browse"}
        </p>
      </div>

      {status === "success" && (
        <div className="mt-3 flex items-center gap-2 text-sm text-success">
          <CheckCircle2 size={16} />
          {message}
        </div>
      )}
      {status === "error" && (
        <div className="mt-3 flex items-center gap-2 text-sm text-danger">
          <AlertCircle size={16} />
          {message}
        </div>
      )}
    </div>
  );
}
