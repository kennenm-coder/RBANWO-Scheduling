import { Crew, CrewType } from "./types";

export function crewHasType(crew: Crew, ...types: CrewType[]): boolean {
  if (types.includes(crew.crew_type)) return true;
  if (crew.additional_types) {
    return crew.additional_types.some((t) => types.includes(t));
  }
  return false;
}

export function sortByFirstName(crews: Crew[]): Crew[] {
  return [...crews].sort((a, b) => {
    const aFirst = a.name.split(" ")[0].toLowerCase();
    const bFirst = b.name.split(" ")[0].toLowerCase();
    if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

export function parseCity(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    return parts[parts.length - 2] || parts[0];
  }
  const words = address.split(" ");
  if (words.length >= 3) {
    const stateZipPattern = /^[A-Z]{2}$/;
    const zipPattern = /^\d{5}/;
    for (let i = words.length - 1; i >= 1; i--) {
      if (stateZipPattern.test(words[i]) || zipPattern.test(words[i])) continue;
      return words[i];
    }
  }
  return address;
}

export function getCrewDepartments(crews: Crew[]) {
  const active = crews.filter((c) => c.is_active);
  const main = active.filter((c) => !crewHasType(c, "misc", "second", "management"));
  const management = active.filter((c) => c.crew_type === "management");
  const seconds = active.filter((c) => c.crew_type === "second");

  return {
    measure: sortByFirstName(main.filter((c) => crewHasType(c, "measure_tech"))),
    measureManagement: sortByFirstName(management.filter((c) => c.manages?.includes("measure"))),
    install: sortByFirstName(main.filter((c) => crewHasType(c, "install_in_house", "install_sub"))),
    installSeconds: sortByFirstName(
      seconds.filter((c) => {
        const primary = active.find((p) => p.id === c.primary_crew_id);
        return primary && (primary.crew_type === "install_in_house" || primary.crew_type === "install_sub");
      })
    ),
    installManagement: sortByFirstName(management.filter((c) => c.manages?.includes("install"))),
    service: sortByFirstName(main.filter((c) => crewHasType(c, "svc"))),
    serviceManagement: sortByFirstName(management.filter((c) => c.manages?.includes("service"))),
    jip: sortByFirstName(main.filter((c) => crewHasType(c, "jip"))),
    jipSeconds: sortByFirstName(
      seconds.filter((c) => {
        const primary = active.find((p) => p.id === c.primary_crew_id);
        return primary && primary.crew_type === "jip";
      })
    ),
    jipManagement: sortByFirstName(management.filter((c) => c.manages?.includes("jip"))),
  };
}

export interface DepartmentSection {
  key: string;
  title: string;
  crews: Crew[];
  filterType: "tech_measure" | "install" | "service" | "jip";
}

export function getDepartmentSections(crews: Crew[]): DepartmentSection[] {
  const d = getCrewDepartments(crews);
  const sections: DepartmentSection[] = [];

  if (d.measure.length) sections.push({ key: "measure", title: "Measure Techs", crews: d.measure, filterType: "tech_measure" });
  if (d.measureManagement.length) sections.push({ key: "measure-mgmt", title: "Measure Management", crews: d.measureManagement, filterType: "tech_measure" });
  if (d.install.length) sections.push({ key: "install", title: "Install", crews: d.install, filterType: "install" });
  if (d.installSeconds.length) sections.push({ key: "install-seconds", title: "Install Seconds", crews: d.installSeconds, filterType: "install" });
  if (d.installManagement.length) sections.push({ key: "install-mgmt", title: "Install Management", crews: d.installManagement, filterType: "install" });
  if (d.service.length) sections.push({ key: "service", title: "Service", crews: d.service, filterType: "service" });
  if (d.serviceManagement.length) sections.push({ key: "service-mgmt", title: "Service Management", crews: d.serviceManagement, filterType: "service" });
  if (d.jip.length) sections.push({ key: "jip", title: "JIP", crews: d.jip, filterType: "jip" });
  if (d.jipSeconds.length) sections.push({ key: "jip-seconds", title: "JIP Seconds", crews: d.jipSeconds, filterType: "jip" });
  if (d.jipManagement.length) sections.push({ key: "jip-mgmt", title: "JIP Management", crews: d.jipManagement, filterType: "jip" });

  return sections;
}
