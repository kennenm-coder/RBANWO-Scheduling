import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import JobLinksProvider from "./JobLinksProvider";
import JobLinkChips from "./JobLinkChips";
import { addressKey } from "@/lib/address-match";

vi.mock("./AuthProvider", () => ({ useAuth: () => ({ status: "authed", roles: ["admin"], user: null }) }));

const store = vi.hoisted(() => ({
  legacy: null as Map<string, string> | null,
  linked: null as Map<string, string> | null,
  writeUps: null as Map<string, unknown[]> | null,
  sig: "1:a",
  pulls: 0,
}));

vi.mock("@/lib/job-links-store", () => ({
  fetchLegacyLinkMap: async () => store.legacy,
  fetchLinkedJobMap: async () => {
    store.pulls++;
    return store.linked;
  },
  fetchJobLinkSignatures: async () => ({ legacy: store.sig, linked: store.sig, writeUps: store.sig }),
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

  it("re-checks on focus but only re-pulls a table whose fingerprint moved", async () => {
    store.linked = new Map([["A1", "job-1"]]);
    store.legacy = new Map();
    store.writeUps = new Map();
    store.sig = "1:a";
    store.pulls = 0;
    render(
      <JobLinksProvider>
        <JobLinkChips appointment={install} />
      </JobLinksProvider>
    );
    await waitFor(() => expect(screen.getByText("Mat List")).toBeTruthy());
    expect(store.pulls).toBe(1);

    const realNow = Date.now;
    Date.now = () => realNow() + 120_000; // past the one-minute throttle
    try {
      // Nothing changed: the check runs but pulls nothing.
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(store.pulls).toBe(1);

      // Something changed: it pulls again.
      store.sig = "2:b";
      Date.now = () => realNow() + 300_000;
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(store.pulls).toBe(2);
    } finally {
      Date.now = realNow;
    }
  });
});
