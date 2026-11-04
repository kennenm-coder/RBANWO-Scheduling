import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import JobLinksProvider from "./JobLinksProvider";
import JobLinkChips from "./JobLinkChips";
import { addressKey } from "@/lib/address-match";

vi.mock("./AuthProvider", () => ({ useAuth: () => ({ status: "authed", roles: ["admin"], user: null }) }));

const store = vi.hoisted(() => ({
  legacy: null as Map<string, string> | null,
  linked: null as Map<string, string> | null,
  writeUps: null as Map<string, unknown[]> | null,
}));

vi.mock("@/lib/job-links-store", () => ({
  fetchLegacyLinkMap: async () => store.legacy,
  fetchLinkedJobMap: async () => store.linked,
  fetchActiveWriteUpIndex: async () => store.writeUps,
  upsertLegacyLink: async () => true,
  deleteLegacyLink: async () => true,
}));

const install = { appointment_type: "install", order_number: "A1", address: "1 Oak St" } as never;

describe("JobLinkChips", () => {
  it("renders nothing outside a provider (existing tiles are unaffected)", () => {
    const { container } = render(<JobLinkChips appointment={install} />);
    expect(container.textContent).toBe("");
  });

  it("shows Mat List and prefers it over Legacy", async () => {
    store.linked = new Map([["A1", "job-1"]]);
    store.legacy = new Map([["A1", "https://drive/x"]]);
    store.writeUps = new Map();
    render(
      <JobLinksProvider>
        <JobLinkChips appointment={install} />
      </JobLinksProvider>
    );
    await waitFor(() => expect(screen.getByText("Mat List")).toBeTruthy());
    expect(screen.queryByText("Legacy")).toBeNull();
  });

  it("shows Legacy when there is no material list", async () => {
    store.linked = new Map();
    store.legacy = new Map([["A1", "https://drive/x"]]);
    store.writeUps = new Map();
    render(
      <JobLinksProvider>
        <JobLinkChips appointment={install} />
      </JobLinksProvider>
    );
    await waitFor(() => expect(screen.getByText("Legacy")).toBeTruthy());
  });

  it("shows write-up count on service tiles by address", async () => {
    store.linked = new Map();
    store.legacy = new Map();
    store.writeUps = new Map([[addressKey("9 Elm Ave").street, [{ id: "w", orderNumber: "Z", zip: "" }]]]);
    render(
      <JobLinksProvider>
        <JobLinkChips appointment={{ appointment_type: "service", order_number: "S9", address: "9 Elm Avenue" } as never} />
      </JobLinksProvider>
    );
    await waitFor(() => expect(screen.getByText("Write-Ups 1")).toBeTruthy());
  });

  it("stays blank if every read fails", async () => {
    store.linked = null;
    store.legacy = null;
    store.writeUps = null;
    const { container } = render(
      <JobLinksProvider>
        <JobLinkChips appointment={install} />
      </JobLinksProvider>
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(container.textContent).toBe("");
  });
});
