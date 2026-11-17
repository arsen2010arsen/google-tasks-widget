import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Task, TaskList, AppConfig, SyncStatus } from "../types";

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

class AuthExpiredError extends Error {
  constructor(message = "Термін дії сесії Google минув. Увійдіть повторно.") {
    super(message);
    this.name = "AuthExpiredError";
  }
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

export class GoogleTasksService {
  private config: AppConfig;
  private syncStatus: SyncStatus = { state: "ok", error: null };
  private refreshPromise: Promise<boolean> | null = null;

  constructor() {
    this.config = this.loadConfig();
    this.initMockStorage();
    if (this.config.useMockData || !this.config.accessToken) {
      this.syncStatus = { state: "mock", error: null };
    }
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public getSyncStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  public getPendingCount(): number {
    return this.getPendingQueue().length;
  }

  public saveConfig(newConfig: Partial<AppConfig>) {
    this.config = { ...this.config, ...newConfig };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    if (this.config.useMockData || !this.config.accessToken) {
      this.syncStatus = { state: "mock", error: null };
    }
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

  private getTasksCacheKey(listId: string): string {
    return !listId || listId === "@default"
      ? TASKS_STORAGE_KEY
      : `${TASKS_STORAGE_KEY}_${listId}`;
  }

  private readCachedTasks(listId: string, fallbackToDefaultMock: boolean): Task[] {
    const key = this.getTasksCacheKey(listId);
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
    return fallbackToDefaultMock && listId === "@default" ? DEFAULT_MOCK_TASKS : [];
  }

  private writeCachedTasks(listId: string, tasks: Task[]) {
    localStorage.setItem(this.getTasksCacheKey(listId), JSON.stringify(tasks));
  }

  // --- Shared Auth & Fetch Wrapper ---
  private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const execute = (token: string) => {
      const headers = new Headers(options.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(url, { ...options, headers });
    };

    let res = await execute(this.config.accessToken);

    if (res.status === 401) {
      if (this.config.refreshToken) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          res = await execute(this.config.accessToken);
        }
      }
      if (res.status === 401) {
        const msg = "Сесія Google закінчилась (термін дії токена минув). Увійдіть повторно.";
        this.syncStatus = { state: "auth_expired", error: msg };
        throw new AuthExpiredError(msg);
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Google API помилка (${res.status}): ${text || res.statusText}`);
    }

    return res;
  }

  // --- OAuth Flow Helpers ---
  public buildOAuthUrl(clientId: string): string {
    const redirectUri = "http://127.0.0.1:8085";
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      clientId.trim()
    )}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&scope=${encodeURIComponent(
      "https://www.googleapis.com/auth/tasks"
    )}&access_type=offline&prompt=consent`;
  }

  public async openExternalUrl(url: string): Promise<void> {
    try {
      await openUrl(url);
    } catch {
      await invoke("open_browser_url", { url });
    }
  }

  public async runOAuthLoopbackFlow(
    onUrlReady?: (url: string) => void
  ): Promise<boolean> {
    const cleanClientId = (this.config.clientId || "").trim();
    const cleanClientSecret = (this.config.clientSecret || "").trim();

    if (!cleanClientId || !cleanClientSecret) {
      throw new Error("Вкажіть Client ID та Client Secret у налаштуваннях");
    }

    const authUrl = this.buildOAuthUrl(cleanClientId);
    onUrlReady?.(authUrl);

    const codePromise = invoke<string>("wait_for_oauth_code");
    await this.openExternalUrl(authUrl);

    const code = await codePromise;
    return this.exchangeCodeForTokens(code);
  }

  // --- Offline Queue Handling ---
  private getPendingQueue(): PendingMutation[] {
    try {
      const raw = localStorage.getItem(PENDING_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private savePendingQueue(queue: PendingMutation[]) {
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
  }

  private enqueueMutation(mutation: PendingMutation) {
    const q = this.getPendingQueue();
    q.push(mutation);
    this.savePendingQueue(q);
  }

  private migrateTempTaskId(tempId: string, serverId: string, listId: string) {
    if (!tempId || !serverId || tempId === serverId) return;

    // Migrate starred status
    const starred = this.getStarredIds();
    if (starred.has(tempId)) {
      starred.delete(tempId);
      starred.add(serverId);
      localStorage.setItem(STARRED_TASKS_KEY, JSON.stringify(Array.from(starred)));
    }

    // Migrate due time
    const dueTimes = this.getDueTimes();
    if (dueTimes[tempId]) {
      dueTimes[serverId] = dueTimes[tempId];
      delete dueTimes[tempId];
      localStorage.setItem(DUE_TIMES_KEY, JSON.stringify(dueTimes));
    }

    // Migrate task in local cache
    const cached = this.readCachedTasks(listId, false);
    const idx = cached.findIndex((t) => t.id === tempId);
    if (idx !== -1) {
      cached[idx].id = serverId;
      this.writeCachedTasks(listId, cached);
    }

    // Migrate any queued mutations referencing tempId
    const queue = this.getPendingQueue();
    let queueChanged = false;
    for (const item of queue) {
      if (item.payload?.taskId === tempId) {
        item.payload.taskId = serverId;
        queueChanged = true;
      }
    }
    if (queueChanged) {
      this.savePendingQueue(queue);
    }
  }

  public async flushPendingQueue(): Promise<void> {
    if (this.config.useMockData || !this.config.accessToken) return;

    const queue = this.getPendingQueue();
    if (queue.length === 0) return;

    const remaining: PendingMutation[] = [];

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      try {
        if (item.type === "create") {
          const listId = item.payload.listId || "@default";
          const serverId = await this.createTaskDirect(
            item.payload.title,
            item.payload.due,
            listId,
            item.payload.notes
          );
          if (serverId && item.payload.tempId) {
            this.migrateTempTaskId(item.payload.tempId, serverId, listId);
          }
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
        if (err instanceof AuthExpiredError) {
          // Preserve this and all subsequent mutations until user re-authenticates
          remaining.push(...queue.slice(i));
          break;
        }
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
    this.syncStatus = { state: "ok", error: null };
    this.saveConfig({
      clientId: cleanClientId,
      clientSecret: cleanClientSecret,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.config.refreshToken,
      useMockData: false,
    });

    return true;
  }

  // --- Task Lists (Paginated) ---
  public async getTaskLists(): Promise<TaskList[]> {
    if (this.config.useMockData || !this.config.accessToken) {
      this.syncStatus = { state: "mock", error: null };
      return [{ id: "@default", title: "Мої завдання" }];
    }

    try {
      const rawLists: any[] = [];
      let pageToken: string | undefined = undefined;

      do {
        const params = new URLSearchParams({ maxResults: "100" });
        if (pageToken) params.set("pageToken", pageToken);

        const res = await this.fetchWithAuth(
          `https://tasks.googleapis.com/tasks/v1/users/@me/lists?${params.toString()}`
        );
        const data = await res.json();
        if (Array.isArray(data.items)) {
          rawLists.push(...data.items);
        }
        pageToken = data.nextPageToken;
      } while (pageToken);

      const lists: TaskList[] = rawLists.map((l: any) => ({
        id: l.id,
        title: l.title || "Мої завдання",
        updated: l.updated,
      }));

      if (lists.length > 0) {
        localStorage.setItem(TASK_LISTS_STORAGE_KEY, JSON.stringify(lists));
        return lists;
      }
      return [{ id: "@default", title: "Мої завдання" }];
    } catch (err) {
      if (!(err instanceof AuthExpiredError)) {
        this.syncStatus = {
          state: "offline",
          error: "Немає зв'язку з Google Tasks (показано кеш).",
        };
      }
      const cached = localStorage.getItem(TASK_LISTS_STORAGE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch {}
      }
      return [{ id: "@default", title: "Мої завдання" }];
    }
  }

  public getStarredIds(): Set<string> {
    try {
      const raw = localStorage.getItem(STARRED_TASKS_KEY);
      if (!raw) {
        localStorage.setItem(STARRED_TASKS_KEY, JSON.stringify(INITIAL_STARRED_TASK_IDS));
        return new Set(INITIAL_STARRED_TASK_IDS);
      }
      return new Set(JSON.parse(raw));
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
  }

  // Unified tasks fetcher (fetches ALL pages with maxResults=100)
  public async getAllTasks(listId: string = "@default"): Promise<Task[]> {
    const starredIds = this.getStarredIds();
    const dueTimes = this.getDueTimes();

    if (this.config.useMockData || !this.config.accessToken) {
      this.syncStatus = { state: "mock", error: null };
      return this.readCachedTasks(listId, true).map((t: Task) => ({
        ...t,
        starred: starredIds.has(t.id),
        dueTime: dueTimes[t.id] || t.dueTime,
      }));
    }

    await this.flushPendingQueue();

    try {
      const rawItems: any[] = [];
      let pageToken: string | undefined = undefined;

      do {
        const params = new URLSearchParams({
          showCompleted: "true",
          showHidden: "true",
          maxResults: "100",
        });
        if (pageToken) params.set("pageToken", pageToken);

        const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
          listId
        )}/tasks?${params.toString()}`;
        const res = await this.fetchWithAuth(url);
        const data = await res.json();

        if (Array.isArray(data.items)) {
          rawItems.push(...data.items);
        }
        pageToken = data.nextPageToken;
      } while (pageToken);

      // Sort active tasks by position ascending, completed tasks by completed/updated descending
      const activeRaw = rawItems
        .filter((i) => i.status !== "completed" && !i.deleted)
        .sort((a, b) => String(a.position || "").localeCompare(String(b.position || "")));

      const completedRaw = rawItems
        .filter((i) => i.status === "completed" && !i.deleted)
        .sort((a, b) => {
          const tA = new Date(a.completed || a.updated || 0).getTime();
          const tB = new Date(b.completed || b.updated || 0).getTime();
          return tB - tA;
        });

      const items: Task[] = [...activeRaw, ...completedRaw].map((item: any) => ({
        id: item.id,
        title: item.title || "(Без назви)",
        notes: item.notes,
        status: item.status === "completed" ? "completed" : "needsAction",
        due: item.due,
        dueTime: dueTimes[item.id] || undefined,
        updated: item.updated,
        listId,
        starred: starredIds.has(item.id),
      }));

      this.syncStatus = { state: "ok", error: null };
      this.writeCachedTasks(listId, items);
      return items;
    } catch (err) {
      console.warn("Failed fetching tasks from Google, using cached tasks", err);
      if (!(err instanceof AuthExpiredError)) {
        this.syncStatus = {
          state: "offline",
          error: "Немає зв'язку з Google Tasks (показано локальний кеш).",
        };
      }
      return this.readCachedTasks(listId, true).map((t: Task) => ({
        ...t,
        starred: starredIds.has(t.id),
        dueTime: dueTimes[t.id] || t.dueTime,
      }));
    }
  }

  public async setTaskStatus(
    taskId: string,
    completed: boolean,
    listId: string = "@default"
  ): Promise<void> {
    const status = completed ? "completed" : "needsAction";

    const cached = this.readCachedTasks(listId, false);
    const idx = cached.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      cached[idx].status = status;
      cached[idx].updated = new Date().toISOString();
      this.writeCachedTasks(listId, cached);
    }

    if (this.config.useMockData || !this.config.accessToken) return;

    try {
      await this.setTaskStatusDirect(taskId, completed, listId);
    } catch (err) {
      if (!(err instanceof AuthExpiredError)) {
        this.syncStatus = { state: "offline", error: "Зміни поставлено в чергу синхронізації." };
      }
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

    await this.fetchWithAuth(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });
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

    const tempId = `task-${Date.now()}`;
    const newTask: Task = {
      id: tempId,
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
      this.setTaskStarred(tempId, true);
    }
    if (dueTime) {
      this.setTaskDueTime(tempId, dueTime);
    }

    const tasks = this.readCachedTasks(listId, false);
    tasks.unshift(newTask);
    this.writeCachedTasks(listId, tasks);

    if (this.config.useMockData || !this.config.accessToken) {
      return newTask;
    }

    try {
      const serverId = await this.createTaskDirect(title, formattedDue, listId, notes);
      if (serverId) {
        this.migrateTempTaskId(tempId, serverId, listId);
        newTask.id = serverId;
      }
    } catch (err) {
      if (!(err instanceof AuthExpiredError)) {
        this.syncStatus = { state: "offline", error: "Зміни поставлено в чергу синхронізації." };
      }
      this.enqueueMutation({
        id: `mut-${Date.now()}`,
        type: "create",
        payload: { tempId, title, due: formattedDue, listId, notes, dueTime },
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
    const res = await this.fetchWithAuth(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, due, notes }),
    });
    const data = await res.json();
    return data.id || null;
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

    const tasks = this.readCachedTasks(listId, false);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      tasks[idx].title = title;
      if (due !== undefined) tasks[idx].due = due;
      if (dueTime !== undefined) tasks[idx].dueTime = dueTime || undefined;
      if (notes !== undefined) tasks[idx].notes = notes;
      tasks[idx].updated = new Date().toISOString();
      this.writeCachedTasks(listId, tasks);
    }

    if (this.config.useMockData || !this.config.accessToken) return;

    try {
      await this.updateTaskDirect(taskId, title, due, listId, notes);
    } catch (err) {
      if (!(err instanceof AuthExpiredError)) {
        this.syncStatus = { state: "offline", error: "Зміни поставлено в чергу синхронізації." };
      }
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

    await this.fetchWithAuth(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    });
  }

  public async deleteTask(taskId: string, listId: string = "@default"): Promise<void> {
    this.setTaskDueTime(taskId, undefined);
    const tasks = this.readCachedTasks(listId, false);
    const filtered = tasks.filter((t) => t.id !== taskId);
    this.writeCachedTasks(listId, filtered);

    if (this.config.useMockData || !this.config.accessToken) return;

    try {
      await this.deleteTaskDirect(taskId, listId);
    } catch (err) {
      if (!(err instanceof AuthExpiredError)) {
        this.syncStatus = { state: "offline", error: "Зміни поставлено в чергу синхронізації." };
      }
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
    await this.fetchWithAuth(url, { method: "DELETE" });
  }

  public async refreshAccessToken(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
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

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.warn("OAuth refresh failed:", res.status, errBody);
          return false;
        }

        const data = await res.json();
        if (data.access_token) {
          this.saveConfig({
            accessToken: data.access_token,
            refreshToken: data.refresh_token || this.config.refreshToken,
          });
          this.syncStatus = { state: "ok", error: null };
          return true;
        }
      } catch (err) {
        console.error("Error refreshing Google access token", err);
      }
      return false;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
}

export const tasksService = new GoogleTasksService();
