import { Task, TaskList, AppConfig } from "../types";

const CONFIG_KEY = "g_tasks_widget_config";
const TASKS_STORAGE_KEY = "g_tasks_mock_tasks";
const TASK_LISTS_STORAGE_KEY = "g_tasks_lists";
const PENDING_QUEUE_KEY = "g_tasks_pending_queue";
const STARRED_TASKS_KEY = "g_tasks_starred_ids";
const DUE_TIMES_KEY = "g_tasks_due_times";

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
  isPositionLocked: false,
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
    starred: true,
  },
  {
    id: "task-2",
    title: "Налаштувати Google Tasks API ключ",
    notes: "Створити OAuth 2.0 Client ID у Google Cloud Console",
    status: "needsAction",
    due: new Date(Date.now() + 86400000).toISOString(),
    listId: "@default",
    updated: new Date().toISOString(),
    starred: true,
  },
  {
    id: "task-4",
    title: "Код-рев'ю пул-реквесту",
    status: "needsAction",
    listId: "@default",
    updated: new Date().toISOString(),
    starred: false,
  },
  {
    id: "task-5",
    title: "Купити каву в зернах",
    status: "completed",
    listId: "@default",
    updated: new Date().toISOString(),
    starred: false,
  },
];

const INITIAL_STARRED_TASK_IDS: string[] = ["task-1", "task-2"];
const INITIAL_STARRED_TITLE_SUBSTRINGS: string[] = [];

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
          await this.createTaskDirect(
            item.payload.title,
            item.payload.due,
            item.payload.listId || "@default",
            item.payload.notes
          );
        } else if (item.type === "complete") {
          await this.setTaskStatusDirect(
            item.payload.taskId,
            item.payload.completed,
            item.payload.listId || "@default"
          );
        } else if (item.type === "delete") {
          await this.deleteTaskDirect(
            item.payload.taskId,
            item.payload.listId || "@default"
          );
        } else if (item.type === "update") {
          await this.updateTaskDirect(
            item.payload.taskId,
            item.payload.title,
            item.payload.due,
            item.payload.listId || "@default",
            item.payload.notes
          );
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
    const cleanClientId = (this.config.clientId || "").trim();
    const cleanClientSecret = (this.config.clientSecret || "").trim();

    if (!cleanClientId || !cleanClientSecret) {
      throw new Error("Вкажіть Client ID та Client Secret перед входом");
    }

    const params = new URLSearchParams({
      code,
      client_id: cleanClientId,
      client_secret: cleanClientSecret,
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
      clientId: cleanClientId,
      clientSecret: cleanClientSecret,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.config.refreshToken,
      useMockData: false,
    });

    return true;
  }

  // --- Task Lists ---
  public async getTaskLists(): Promise<TaskList[]> {
    if (this.config.useMockData || !this.config.accessToken) {
      return [{ id: "@default", title: "Мої завдання" }];
    }

    try {
      const res = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401 && this.config.refreshToken) {
          const refreshed = await this.refreshAccessToken();
          if (refreshed) return this.getTaskLists();
        }
        return [{ id: "@default", title: "Мої завдання" }];
      }

      const data = await res.json();
      const lists: TaskList[] = (data.items || []).map((l: any) => ({
        id: l.id,
        title: l.title || "Мої завдання",
        updated: l.updated,
      }));

      localStorage.setItem(TASK_LISTS_STORAGE_KEY, JSON.stringify(lists));
      return lists.length > 0 ? lists : [{ id: "@default", title: "Мої завдання" }];
    } catch {
      const cached = localStorage.getItem(TASK_LISTS_STORAGE_KEY);
      return cached ? JSON.parse(cached) : [{ id: "@default", title: "Мої завдання" }];
    }
  }

  public getStarredIds(): Set<string> {
    try {
      let set: Set<string>;
      const raw = localStorage.getItem(STARRED_TASKS_KEY);
      if (!raw) {
        set = new Set(INITIAL_STARRED_TASK_IDS);
      } else {
        set = new Set(JSON.parse(raw));
      }

      // One-time seed for user's existing tasks from Google Tasks
      if (!localStorage.getItem("g_tasks_starred_seeded_v3")) {
        for (const id of INITIAL_STARRED_TASK_IDS) {
          set.add(id);
        }
        try {
          const cached = localStorage.getItem(TASKS_STORAGE_KEY);
          if (cached) {
            const tasks: Task[] = JSON.parse(cached);
            for (const t of tasks) {
              const lower = (t.title || "").toLowerCase();
              if (INITIAL_STARRED_TITLE_SUBSTRINGS.some((s) => lower.includes(s))) {
                set.add(t.id);
              }
            }
          }
        } catch {}
        localStorage.setItem(STARRED_TASKS_KEY, JSON.stringify(Array.from(set)));
        localStorage.setItem("g_tasks_starred_seeded_v3", "true");
      }

      return set;
    } catch {
      return new Set(INITIAL_STARRED_TASK_IDS);
    }
  }

  public isTaskStarred(taskId: string): boolean {
    return this.getStarredIds().has(taskId);
  }

  public toggleTaskStarred(taskId: string): boolean {
    const starred = this.getStarredIds();
    const isStarred = !starred.has(taskId);
    if (isStarred) {
      starred.add(taskId);
    } else {
      starred.delete(taskId);
    }
    localStorage.setItem(STARRED_TASKS_KEY, JSON.stringify(Array.from(starred)));

    // Also update local cache
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      try {
        const tasks: Task[] = JSON.parse(raw);
        const idx = tasks.findIndex((t) => t.id === taskId);
        if (idx !== -1) {
          tasks[idx].starred = isStarred;
          localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
        }
      } catch {}
    }

    return isStarred;
  }

  public setTaskStarred(taskId: string, isStarred: boolean): void {
    const starred = this.getStarredIds();
    if (isStarred) {
      starred.add(taskId);
    } else {
      starred.delete(taskId);
    }
    localStorage.setItem(STARRED_TASKS_KEY, JSON.stringify(Array.from(starred)));

    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      try {
        const tasks: Task[] = JSON.parse(raw);
        const idx = tasks.findIndex((t) => t.id === taskId);
        if (idx !== -1) {
          tasks[idx].starred = isStarred;
          localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
        }
      } catch {}
    }
  }

  public getDueTimes(): Record<string, string> {
    try {
      const raw = localStorage.getItem(DUE_TIMES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  public setTaskDueTime(taskId: string, dueTime?: string): void {
    const times = this.getDueTimes();
    if (dueTime) {
      times[taskId] = dueTime;
    } else {
      delete times[taskId];
    }
    localStorage.setItem(DUE_TIMES_KEY, JSON.stringify(times));

    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      try {
        const tasks: Task[] = JSON.parse(raw);
        const idx = tasks.findIndex((t) => t.id === taskId);
        if (idx !== -1) {
          tasks[idx].dueTime = dueTime;
          localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
        }
      } catch {}
    }
  }

  // Unified tasks fetcher (returns ALL tasks including completed)
  public async getAllTasks(listId: string = "@default"): Promise<Task[]> {
    await this.flushPendingQueue();
    const starredIds = this.getStarredIds();
    const dueTimes = this.getDueTimes();

    if (this.config.useMockData || !this.config.accessToken) {
      const raw = localStorage.getItem(TASKS_STORAGE_KEY);
      const all: Task[] = (raw ? JSON.parse(raw) : DEFAULT_MOCK_TASKS).map((t: Task) => ({
        ...t,
        starred: starredIds.has(t.id),
        dueTime: dueTimes[t.id] || t.dueTime,
      }));
      return all;
    }

    try {
      const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
        listId
      )}/tasks?showCompleted=true&showHidden=true`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401 && this.config.refreshToken) {
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            return this.getAllTasks(listId);
          }
        }
        throw new Error(`Google API error: ${res.statusText}`);
      }

      const data = await res.json();
      const items: Task[] = (data.items || []).map((item: any) => {
        let isStarred = starredIds.has(item.id);
        const lower = (item.title || "").toLowerCase();
        if (!isStarred && INITIAL_STARRED_TITLE_SUBSTRINGS.some((s) => lower.includes(s))) {
          isStarred = true;
          starredIds.add(item.id);
        }
        return {
          id: item.id,
          title: item.title || "(Без назви)",
          notes: item.notes,
          status: item.status === "completed" ? "completed" : "needsAction",
          due: item.due,
          dueTime: dueTimes[item.id] || undefined,
          updated: item.updated,
          listId,
          starred: isStarred,
        };
      });

      localStorage.setItem(STARRED_TASKS_KEY, JSON.stringify(Array.from(starredIds)));
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(items));
      return items;
    } catch (err) {
      console.warn("Failed fetching tasks from Google, using cached tasks", err);
      const raw = localStorage.getItem(TASKS_STORAGE_KEY);
      const all: Task[] = (raw ? JSON.parse(raw) : DEFAULT_MOCK_TASKS).map((t: Task) => ({
        ...t,
        starred: starredIds.has(t.id),
        dueTime: dueTimes[t.id] || t.dueTime,
      }));
      return all;
    }
  }

  public async setTaskStatus(
    taskId: string,
    completed: boolean,
    listId: string = "@default"
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
      await this.setTaskStatusDirect(taskId, completed, listId);
    } catch {
      this.enqueueMutation({
        id: `mut-${Date.now()}`,
        type: "complete",
        payload: { taskId, completed, listId },
        timestamp: Date.now(),
      });
    }
  }

  private async setTaskStatusDirect(
    taskId: string,
    completed: boolean,
    listId: string = "@default"
  ): Promise<void> {
    const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
      listId
    )}/tasks/${encodeURIComponent(taskId)}`;
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
      await this.setTaskStatusDirect(taskId, completed, listId);
    }
  }

  public async createTask(
    title: string,
    due?: string,
    listId: string = "@default",
    notes?: string,
    starred: boolean = false,
    dueTime?: string
  ): Promise<Task> {
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
      notes,
      status: "needsAction",
      due: formattedDue,
      dueTime,
      listId,
      updated: new Date().toISOString(),
      starred,
    };

    if (starred) {
      this.setTaskStarred(newTask.id, true);
    }
    if (dueTime) {
      this.setTaskDueTime(newTask.id, dueTime);
    }

    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    const tasks: Task[] = raw ? JSON.parse(raw) : [];
    tasks.unshift(newTask);
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));

    if (this.config.useMockData || !this.config.accessToken) {
      return newTask;
    }

    try {
      const serverId = await this.createTaskDirect(title, formattedDue, listId, notes);
      if (serverId) {
        if (starred) {
          this.setTaskStarred(serverId, true);
        }
        if (dueTime) {
          this.setTaskDueTime(serverId, dueTime);
        }
        newTask.id = serverId;
      }
    } catch {
      this.enqueueMutation({
        id: `mut-${Date.now()}`,
        type: "create",
        payload: { title, due: formattedDue, listId, notes, dueTime },
        timestamp: Date.now(),
      });
    }

    return newTask;
  }

  private async createTaskDirect(
    title: string,
    due?: string,
    listId: string = "@default",
    notes?: string
  ): Promise<string | null> {
    const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
      listId
    )}/tasks`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, due, notes }),
    });

    if (res.ok) {
      const data = await res.json();
      return data.id;
    } else if (res.status === 401 && this.config.refreshToken) {
      await this.refreshAccessToken();
      return this.createTaskDirect(title, due, listId, notes);
    }
    return null;
  }

  public async updateTask(
    taskId: string,
    title: string,
    due?: string,
    listId: string = "@default",
    notes?: string,
    dueTime?: string
  ): Promise<void> {
    if (dueTime !== undefined) {
      this.setTaskDueTime(taskId, dueTime || undefined);
    }
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      const tasks: Task[] = JSON.parse(raw);
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx !== -1) {
        tasks[idx].title = title;
        if (due !== undefined) tasks[idx].due = due;
        if (dueTime !== undefined) tasks[idx].dueTime = dueTime || undefined;
        if (notes !== undefined) tasks[idx].notes = notes;
        tasks[idx].updated = new Date().toISOString();
        localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
      }
    }

    if (this.config.useMockData || !this.config.accessToken) return;

    try {
      await this.updateTaskDirect(taskId, title, due, listId, notes);
    } catch {
      this.enqueueMutation({
        id: `mut-${Date.now()}`,
        type: "update",
        payload: { taskId, title, due, listId, notes, dueTime },
        timestamp: Date.now(),
      });
    }
  }

  private async updateTaskDirect(
    taskId: string,
    title: string,
    due?: string,
    listId: string = "@default",
    notes?: string
  ): Promise<void> {
    const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
      listId
    )}/tasks/${encodeURIComponent(taskId)}`;
    const bodyObj: any = { title };
    if (due !== undefined) bodyObj.due = due;
    if (notes !== undefined) bodyObj.notes = notes;

    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyObj),
    });

    if (!res.ok && res.status === 401 && this.config.refreshToken) {
      await this.refreshAccessToken();
      await this.updateTaskDirect(taskId, title, due, listId, notes);
    }
  }

  public async deleteTask(taskId: string, listId: string = "@default"): Promise<void> {
    this.setTaskDueTime(taskId, undefined);
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      const tasks: Task[] = JSON.parse(raw);
      const filtered = tasks.filter((t) => t.id !== taskId);
      localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(filtered));
    }

    if (this.config.useMockData || !this.config.accessToken) return;

    try {
      await this.deleteTaskDirect(taskId, listId);
    } catch {
      this.enqueueMutation({
        id: `mut-${Date.now()}`,
        type: "delete",
        payload: { taskId, listId },
        timestamp: Date.now(),
      });
    }
  }

  private async deleteTaskDirect(
    taskId: string,
    listId: string = "@default"
  ): Promise<void> {
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
      await this.deleteTaskDirect(taskId, listId);
    }
  }

  public async refreshAccessToken(): Promise<boolean> {
    const cleanClientId = (this.config.clientId || "").trim();
    const cleanClientSecret = (this.config.clientSecret || "").trim();
    if (!this.config.refreshToken || !cleanClientId) return false;

    try {
      const params = new URLSearchParams({
        client_id: cleanClientId,
        client_secret: cleanClientSecret,
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
