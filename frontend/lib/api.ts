/**
 * Shared API base + multi-project URL helper.
 *
 * When a project is selected (localStorage `pyronites_project_id`), data routes
 * are rewritten to `/api/projects/{id}/...` so tables/storage/sql/keys hit the
 * correct SQLite file. Auth and project registry stay unscoped.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const PROJECT_STORAGE_KEY = "pyronites_project_id";
export const PROJECT_NAME_KEY = "pyronites_project_name";
export const PROJECT_CHANGE_EVENT = "pyronites-project";

export type ProjectSummary = {
  id: string;
  project_id: string;
  slug?: string;
  name: string;
  status?: string;
};

export function getStoredProjectId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PROJECT_STORAGE_KEY);
}

export function getStoredProjectName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PROJECT_NAME_KEY);
}

export function setStoredProject(project: {
  id: string;
  name?: string;
}): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROJECT_STORAGE_KEY, project.id);
  if (project.name) {
    localStorage.setItem(PROJECT_NAME_KEY, project.name);
  }
  window.dispatchEvent(new Event(PROJECT_CHANGE_EVENT));
}

export function clearStoredProject(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PROJECT_STORAGE_KEY);
  localStorage.removeItem(PROJECT_NAME_KEY);
  window.dispatchEvent(new Event(PROJECT_CHANGE_EVENT));
}

/**
 * Build a full URL. Project-scoped paths are rewritten when a project is selected.
 *
 * @param path - e.g. `/tables`, `/storage/upload`, `/api/keys`, `/api/stats`
 */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const id =
    typeof window !== "undefined" ? getStoredProjectId() : null;

  if (!id) {
    return `${API_BASE}${p}`;
  }

  const scoped =
    p.startsWith("/tables") ||
    p.startsWith("/storage") ||
    p.startsWith("/sql") ||
    p.startsWith("/api/keys") ||
    p === "/api/stats" ||
    p.startsWith("/api/stats?");

  if (scoped) {
    if (p === "/api/stats" || p.startsWith("/api/stats?")) {
      return `${API_BASE}/api/projects/${encodeURIComponent(id)}/stats`;
    }
    return `${API_BASE}/api/projects/${encodeURIComponent(id)}${p}`;
  }

  return `${API_BASE}${p}`;
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await fetch(`${API_BASE}/api/projects`, {
    credentials: "include",
  });
  if (!res.ok) return [];
  const body = await res.json();
  const list = (body?.projects ?? body) as ProjectSummary[];
  return Array.isArray(list) ? list : [];
}
