import { Task, AppConfig } from "../types";

const CONFIG_KEY = "g_tasks_widget_config";
const TASKS_STORAGE_KEY = "g_tasks_mock_tasks";

const DEFAULT_CONFIG: AppConfig = {
  clientId: "",
  clientSecret: "",
  apiKey: "",
  accessToken: "",
  refreshToken: "",
  alwaysOnTop: false,
  autoRefreshMinutes: 5,
  useMockData: true,
};

const DEFAULT_MOCK_TASKS: Task[] = [
  {
    id: "task-1",
    title: "Підготувати звіт для команди",
    notes: "Зібрати метрики за тиждень",
    status: "needsAction",
    due: new Date().toISOString(),
    listId: "@default",
    updated: new Date().toISOString(),
  },
  {
    id: "task-2",
    title: "Налаштувати Google Tasks API ключ",
    notes: "Створити OAuth 2.0 Client ID у Google Cloud Console",
    status: "needsAction",
    due: new Date(Date.now() + 86400000).toISOString(),
    listId: "@default",
    updated: new Date().toISOString(),
  },
  {
    id: "task-4",
    title: "Код-рев'ю пул-реквесту",
    status: "needsAction",
    listId: "@default",
    updated: new Date().toISOString(),
  },
  {
    id: "task-5",
    title: "Купити каву в зернах",
    status: "needsAction",
    listId: "@default",
    updated: new Date().toISOString(),
  },
];

export class GoogleTasksService {
  private config: AppConfig;

  constructor() {
    this.config = this.loadConfig();
    this.initMockStorage();
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public saveConfig(newConfig: Partial<AppConfig>) {
    this.config = { ...this.config, ...newConfig };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
  }

  private loadConfig(): AppConfig {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  private initMockStorage() {
    if (!localStorage.getItem(TASKS_STORAGE_KEY)) {
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(DEFAULT_MOCK_TASKS));
    }
  }

  // Unified tasks fetcher (active tasks only)
  public async getAllTasks(): Promise<Task[]> {
    if (this.config.useMockData || !this.config.accessToken) {
      const raw = localStorage.getItem(TASKS_STORAGE_KEY);
      const all: Task[] = raw ? JSON.parse(raw) : DEFAULT_MOCK_TASKS;
      return all.filter((t) => t.status !== "completed");
    }

    try {
      // Only fetch active (non-completed) tasks
      const url = `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&showHidden=false`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401 && this.config.refreshToken) {
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            return this.getAllTasks();
          }
        }
        throw new Error(`Google API error: ${res.statusText}`);
      }

      const data = await res.json();
      const items: Task[] = (data.items || []).map((item: any) => ({
        id: item.id,
        title: item.title || "(Без назви)",
        notes: item.notes,
        status: item.status === "completed" ? "completed" : "needsAction",
        due: item.due,
        updated: item.updated,
        listId: "@default",
      }));

      // Cache locally
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(items));
      return items.filter((t) => t.status !== "completed");
    } catch (err) {
      console.warn("Failed fetching tasks from Google, using cached tasks", err);
      const raw = localStorage.getItem(TASKS_STORAGE_KEY);
      const all: Task[] = raw ? JSON.parse(raw) : DEFAULT_MOCK_TASKS;
      return all.filter((t) => t.status !== "completed");
    }
  }

  public async setTaskStatus(
    taskId: string,
    completed: boolean,
    listId = "@default"
  ): Promise<void> {
    const status = completed ? "completed" : "needsAction";

    // Update local cache
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      const tasks: Task[] = JSON.parse(raw);
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx !== -1) {
        tasks[idx].status = status;
        tasks[idx].updated = new Date().toISOString();
        localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
      }
    }

    if (this.config.useMockData || !this.config.accessToken) return;

    try {
      const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
        listId
      )}/tasks/${encodeURIComponent(taskId)}`;

      const patchBody =
        status === "completed"
          ? { status: "completed" }
          : { status: "needsAction", completed: null };

      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchBody),
      });

      if (!res.ok && res.status === 401 && this.config.refreshToken) {
        await this.refreshAccessToken();
        await this.setTaskStatus(taskId, completed, listId);
      }
    } catch (err) {
      console.error("Failed to patch task status on Google", err);
    }
  }

  public async createTask(title: string, due?: string): Promise<Task> {
    let formattedDue: string | undefined = undefined;
    if (due) {
      try {
        const d = new Date(due);
        formattedDue = d.toISOString().split("T")[0] + "T00:00:00.000Z";
      } catch {
        formattedDue = undefined;
      }
    }

    const newTask: Task = {
      id: `task-${Date.now()}`,
      title,
      status: "needsAction",
      due: formattedDue,
      listId: "@default",
      updated: new Date().toISOString(),
    };

    // Save to local cache
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    const tasks: Task[] = raw ? JSON.parse(raw) : [];
    tasks.unshift(newTask);
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));

    if (this.config.useMockData || !this.config.accessToken) {
      return newTask;
    }

    try {
      const url = `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          due: formattedDue,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        newTask.id = data.id;
      } else if (res.status === 401 && this.config.refreshToken) {
        await this.refreshAccessToken();
        return this.createTask(title, due);
      }
    } catch (err) {
      console.error("Failed to create task on Google API", err);
    }

    return newTask;
  }

  public async deleteTask(taskId: string, listId = "@default"): Promise<void> {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      const tasks: Task[] = JSON.parse(raw);
      const filtered = tasks.filter((t) => t.id !== taskId);
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(filtered));
    }

    if (this.config.useMockData || !this.config.accessToken) return;

    try {
      const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
        listId
      )}/tasks/${encodeURIComponent(taskId)}`;

      const res = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      });

      if (!res.ok && res.status === 401 && this.config.refreshToken) {
        await this.refreshAccessToken();
        await this.deleteTask(taskId, listId);
      }
    } catch (err) {
      console.error("Failed to delete task from Google API", err);
    }
  }

  public async refreshAccessToken(): Promise<boolean> {
    if (!this.config.refreshToken || !this.config.clientId) return false;

    try {
      const params = new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      });

      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (!res.ok) return false;
      const data = await res.json();
      if (data.access_token) {
        this.saveConfig({ accessToken: data.access_token });
        return true;
      }
    } catch (err) {
      console.error("Error refreshing Google access token", err);
    }
    return false;
  }
}

export const tasksService = new GoogleTasksService();
