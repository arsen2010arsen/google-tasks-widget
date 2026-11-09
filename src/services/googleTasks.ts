import { Task, AppConfig } from "../types";

const CONFIG_KEY = "g_tasks_widget_config";
const TASKS_STORAGE_KEY = "g_tasks_mock_tasks";
const PENDING_QUEUE_KEY = "g_tasks_pending_queue";

interface PendingMutation {
  id: string;
  type: "create" | "complete" | "delete" | "update";
  payload: any;
  timestamp: number;
}

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

  // --- Offline Queue Handling ---
  private getPendingQueue(): PendingMutation[] {
    const raw = localStorage.getItem(PENDING_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  private savePendingQueue(queue: PendingMutation[]) {
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
  }

  private enqueueMutation(mutation: PendingMutation) {
    const q = this.getPendingQueue();
    q.push(mutation);
    this.savePendingQueue(q);
  }

  public async flushPendingQueue(): Promise<void> {
    if (this.config.useMockData || !this.config.accessToken) return;

    const queue = this.getPendingQueue();
    if (queue.length === 0) return;

    const remaining: PendingMutation[] = [];

    for (const item of queue) {
      try {
        if (item.type === "create") {
          await this.createTaskDirect(item.payload.title, item.payload.due);
        } else if (item.type === "complete") {
          await this.setTaskStatusDirect(item.payload.taskId, true);
        } else if (item.type === "delete") {
          await this.deleteTaskDirect(item.payload.taskId);
        } else if (item.type === "update") {
          await this.updateTaskDirect(item.payload.taskId, item.payload.title, item.payload.due);
        }
      } catch (err) {
        console.warn("Failed to flush pending mutation, keeping in queue", err);
        remaining.push(item);
      }
    }

    this.savePendingQueue(remaining);
  }

  // --- 1-Click OAuth Exchange ---
  public async exchangeCodeForTokens(code: string): Promise<boolean> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("Вкажіть Client ID та Client Secret перед входом");
    }

    const params = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: "http://127.0.0.1:8085",
      grant_type: "authorization_code",
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Помилка обміну токенів Google: ${errText}`);
    }

    const data = await res.json();
    this.saveConfig({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.config.refreshToken,
      useMockData: false,
    });

    return true;
  }

  // Unified tasks fetcher (active tasks only)
  public async getAllTasks(): Promise<Task[]> {
    // Flush any pending offline changes first
    await this.flushPendingQueue();

    if (this.config.useMockData || !this.config.accessToken) {
      const raw = localStorage.getItem(TASKS_STORAGE_KEY);
      const all: Task[] = raw ? JSON.parse(raw) : DEFAULT_MOCK_TASKS;
      return all.filter((t) => t.status !== "completed");
    }

    try {
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

      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(items));
      return items.filter((t) => t.status !== "completed");
    } catch (err) {
      console.warn("Failed fetching tasks from Google, using cached tasks", err);
      const raw = localStorage.getItem(TASKS_STORAGE_KEY);
      const all: Task[] = raw ? JSON.parse(raw) : DEFAULT_MOCK_TASKS;
      return all.filter((t) => t.status !== "completed");
    }
  }

  public async setTaskStatus(taskId: string, completed: boolean): Promise<void> {
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
      await this.setTaskStatusDirect(taskId, completed);
    } catch {
      this.enqueueMutation({
        id: `mut-${Date.now()}`,
        type: "complete",
        payload: { taskId, completed },
        timestamp: Date.now(),
      });
    }
  }

  private async setTaskStatusDirect(taskId: string, completed: boolean): Promise<void> {
    const url = `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(taskId)}`;
    const patchBody = completed
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
      await this.setTaskStatusDirect(taskId, completed);
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

    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    const tasks: Task[] = raw ? JSON.parse(raw) : [];
    tasks.unshift(newTask);
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));

    if (this.config.useMockData || !this.config.accessToken) {
      return newTask;
    }

    try {
      const serverId = await this.createTaskDirect(title, formattedDue);
      if (serverId) newTask.id = serverId;
    } catch {
      this.enqueueMutation({
        id: `mut-${Date.now()}`,
        type: "create",
        payload: { title, due: formattedDue },
        timestamp: Date.now(),
      });
    }

    return newTask;
  }

  private async createTaskDirect(title: string, due?: string): Promise<string | null> {
    const url = `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, due }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.id;
    } else if (res.status === 401 && this.config.refreshToken) {
      await this.refreshAccessToken();
      return this.createTaskDirect(title, due);
    }
    return null;
  }

  public async updateTask(taskId: string, title: string, due?: string): Promise<void> {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      const tasks: Task[] = JSON.parse(raw);
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx !== -1) {
        tasks[idx].title = title;
        if (due !== undefined) tasks[idx].due = due;
        tasks[idx].updated = new Date().toISOString();
        localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
      }
    }

    if (this.config.useMockData || !this.config.accessToken) return;

    try {
      await this.updateTaskDirect(taskId, title, due);
    } catch {
      this.enqueueMutation({
        id: `mut-${Date.now()}`,
        type: "update",
        payload: { taskId, title, due },
        timestamp: Date.now(),
      });
    }
  }

  private async updateTaskDirect(taskId: string, title: string, due?: string): Promise<void> {
    const url = `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(taskId)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, due }),
    });

    if (!res.ok && res.status === 401 && this.config.refreshToken) {
      await this.refreshAccessToken();
      await this.updateTaskDirect(taskId, title, due);
    }
  }

  public async deleteTask(taskId: string): Promise<void> {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      const tasks: Task[] = JSON.parse(raw);
      const filtered = tasks.filter((t) => t.id !== taskId);
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(filtered));
    }

    if (this.config.useMockData || !this.config.accessToken) return;

    try {
      await this.deleteTaskDirect(taskId);
    } catch {
      this.enqueueMutation({
        id: `mut-${Date.now()}`,
        type: "delete",
        payload: { taskId },
        timestamp: Date.now(),
      });
    }
  }

  private async deleteTaskDirect(taskId: string): Promise<void> {
    const url = `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(taskId)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    });

    if (!res.ok && res.status === 401 && this.config.refreshToken) {
      await this.refreshAccessToken();
      await this.deleteTaskDirect(taskId);
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
