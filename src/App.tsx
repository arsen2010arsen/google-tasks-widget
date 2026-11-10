import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Task, TaskList } from "./types";
import { tasksService } from "./services/googleTasks";
import { SettingsModal } from "./components/SettingsModal";
import {
  RefreshCw,
  Settings,
  Plus,
  Trash2,
  Calendar,
  Check,
  Inbox,
  X,
  Edit2,
  Lock,
  Unlock,
  Minus,
  Star,
  ChevronDown,
  Clock,
} from "lucide-react";
import "./App.css";

const POS_KEY = "g_tasks_window_position";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: any;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, info: any) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="modal-overlay"
          style={{
            justifyContent: "center",
            alignItems: "center",
            textAlign: "center",
            gap: 12,
            zIndex: 100,
          }}
        >
          <div style={{ color: "#ff453a", fontWeight: 600, fontSize: "12px", padding: "0 10px" }}>
            Виникла помилка: {this.state.error?.message || "Непередбачена помилка"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              style={{
                padding: "6px 14px",
                background: "#4285f4",
                border: "none",
                color: "#fff",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 500,
              }}
            >
              Спробувати знову
            </button>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: undefined });
                if (this.props.onReset) this.props.onReset();
              }}
              style={{
                padding: "6px 14px",
                background: "rgba(255,255,255,0.15)",
                border: "none",
                color: "#fff",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: "11px",
              }}
            >
              Закрити
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>("@default");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [selectedDue, setSelectedDue] = useState<string | null>(null);
  const [selectedDueTime, setSelectedDueTime] = useState<string | null>(null);
  const [tempDate, setTempDate] = useState<string>("");
  const [tempTime, setTempTime] = useState<string>("");
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isCompletedOpen, setIsCompletedOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSize, setActiveSize] = useState<"S" | "M" | "L">("S");
  const [isPositionLocked, setIsPositionLocked] = useState<boolean>(
    tasksService.getConfig().isPositionLocked || false
  );
  const [activeTab, setActiveTab] = useState<"all" | "starred">("all");

  // Inline editing state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Load lists and tasks
  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const lists = await tasksService.getTaskLists();
      setTaskLists(lists);
      const fetchedTasks = await tasksService.getAllTasks(selectedListId);
      setTasks(fetchedTasks);
      setIsPositionLocked(tasksService.getConfig().isPositionLocked || false);
    } catch (err) {
      console.error("Failed loading tasks", err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedListId]);

  // Restore saved window position and apply lock on startup
  useEffect(() => {
    const locked = tasksService.getConfig().isPositionLocked || false;
    invoke("set_window_resizable", { resizable: !locked }).catch(() => {});

    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      try {
        const { x, y } = JSON.parse(raw);
        if (typeof x === "number" && typeof y === "number") {
          invoke<[number, number]>("set_window_position", { x: Math.round(x), y: Math.round(y) })
            .then(([clampedX, clampedY]) => {
              localStorage.setItem(POS_KEY, JSON.stringify({ x: clampedX, y: clampedY }));
            })
            .catch(() => {
              invoke("reset_window_position").catch(() => {});
            });
          return;
        }
      } catch {}
    }

    // Default to top-right corner on first startup or if position was lost
    invoke<[number, number]>("set_window_corner", { corner: "top-right" })
      .then(([x, y]) => {
        localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
      })
      .catch(() => {
        invoke("reset_window_position").catch(() => {});
      });
  }, []);

  // Auto-save window position on any move / drag without needing to click anything
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let timeout: any = null;

    try {
      const appWindow = getCurrentWebviewWindow();
      appWindow
        .onMoved(({ payload: pos }) => {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
              localStorage.setItem(POS_KEY, JSON.stringify({ x: pos.x, y: pos.y }));
            }
          }, 200);
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch((e) => console.warn("onMoved listen error", e));
    } catch (e) {
      console.warn("Failed to attach onMoved", e);
    }

    return () => {
      clearTimeout(timeout);
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(() => {
      loadTasks();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  // Window drag handler - only drags if NOT locked
  const handleStartDrag = async (e: React.MouseEvent) => {
    if (isPositionLocked) return;
    if (e.button === 0 && !(e.target as HTMLElement).closest("button, input, form, select, textarea")) {
      try {
        await invoke("start_dragging");
        // On Windows start_dragging blocks until mouse button is released:
        const [x, y] = await invoke<[number, number]>("get_window_position");
        localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
      } catch (err) {
        console.warn("start_dragging error", err);
      }
    }
  };

  // Preset sizes
  const handleSetSize = async (size: "S" | "M" | "L") => {
    if (isPositionLocked) return;
    setActiveSize(size);
    let width = 290;
    let height = 380;
    if (size === "M") {
      width = 330;
      height = 460;
    } else if (size === "L") {
      width = 380;
      height = 560;
    }

    try {
      await invoke("set_window_size", { width, height });
    } catch (err) {
      console.warn("set_window_size error", err);
    }
  };

  // Toggle task completion status (ONLY triggered by clicking the checkbox circle!)
  const handleToggleTaskStatus = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const isNowCompleted = task.status !== "completed";

    // Optimistically update UI
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: isNowCompleted ? "completed" : "needsAction",
              updated: new Date().toISOString(),
            }
          : t
      )
    );

    try {
      await tasksService.setTaskStatus(task.id, isNowCompleted, selectedListId);
    } catch (err) {
      console.error("Failed to update task status", err);
      loadTasks();
    }
  };

  // Toggle task starred status
  const handleToggleStar = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isNowStarred = tasksService.toggleTaskStarred(taskId);
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, starred: isNowStarred } : t))
    );
  };

  // Add new task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;

    const shouldStar = activeTab === "starred";
    const optimisticId = "temp-" + Date.now();
    const newTask: Task = {
      id: optimisticId,
      title,
      status: "needsAction",
      due: selectedDue || undefined,
      dueTime: selectedDueTime || undefined,
      updated: new Date().toISOString(),
      listId: selectedListId,
      starred: shouldStar,
    };

    setTasks((prev) => [newTask, ...prev]);
    setNewTaskTitle("");
    setSelectedDue(null);
    setSelectedDueTime(null);
    setIsDatePickerOpen(false);

    try {
      const created = await tasksService.createTask(
        title,
        selectedDue || undefined,
        selectedListId,
        undefined,
        shouldStar,
        selectedDueTime || undefined
      );
      setTasks((prev) => prev.map((t) => (t.id === optimisticId ? created : t)));
    } catch (err) {
      console.error("Failed creating task", err);
    }
  };

  // Inline edit
  const handleStartEdit = (task: Task, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
  };

  const handleSaveEdit = async (taskId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, title: trimmed } : t))
      );
      await tasksService.updateTask(taskId, trimmed, undefined, selectedListId);
    }
    setEditingTaskId(null);
  };

  // Delete task
  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await tasksService.deleteTask(taskId, selectedListId);
  };

  // Date & Time Helpers
  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const getFutureDateStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const handleOpenDatePicker = () => {
    if (!isDatePickerOpen) {
      if (selectedDue) {
        const d = new Date(selectedDue);
        setTempDate(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        );
        setTempTime(selectedDueTime || "");
      } else {
        setTempDate(getTodayStr());
        setTempTime("");
      }
    }
    setIsDatePickerOpen(!isDatePickerOpen);
  };

  const handleApplyDue = () => {
    if (!tempDate) {
      setSelectedDue(null);
      setSelectedDueTime(null);
    } else {
      const [y, mon, d] = tempDate.split("-").map(Number);
      if (tempTime) {
        const [h, m] = tempTime.split(":").map(Number);
        const dt = new Date(y, mon - 1, d, h, m, 0);
        setSelectedDue(dt.toISOString());
        setSelectedDueTime(tempTime);
      } else {
        const dt = new Date(y, mon - 1, d, 23, 59, 59);
        setSelectedDue(dt.toISOString());
        setSelectedDueTime(null);
      }
    }
    setIsDatePickerOpen(false);
  };

  const handleClearDue = () => {
    setSelectedDue(null);
    setSelectedDueTime(null);
    setTempDate("");
    setTempTime("");
    setIsDatePickerOpen(false);
  };

  const formatDueDate = (dueStr?: string, dueTime?: string) => {
    if (!dueStr) return "";
    const d = new Date(dueStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const taskDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((taskDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    let dateText = "";
    if (diffDays === 0) dateText = "Сьогодні";
    else if (diffDays === 1) dateText = "Завтра";
    else if (diffDays === -1) dateText = "Вчора";
    else dateText = d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });

    if (dueTime) {
      return `${dateText}, ${dueTime}`;
    }
    return dateText;
  };

  const isPastDue = (dueStr?: string, dueTime?: string) => {
    if (!dueStr) return false;
    const d = new Date(dueStr);
    const now = new Date();

    if (dueTime) {
      const [h, m] = dueTime.split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        const fullDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0);
        return fullDate.getTime() < now.getTime();
      }
    }

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const taskDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return taskDate.getTime() < today.getTime();
  };

  const currentTabTasks = activeTab === "starred" ? tasks.filter((t) => t.starred) : tasks;
  const activeTasks = currentTabTasks.filter((t) => t.status !== "completed");
  const completedTasks = currentTabTasks.filter((t) => t.status === "completed");
  const allActiveCount = tasks.filter((t) => t.status !== "completed").length;
  const starredActiveCount = tasks.filter((t) => t.starred && t.status !== "completed").length;

  return (
    <div className="widget-frame">
      <div className="glass-container">
        {/* Header with Title / List selector */}
        <div
          className="widget-header"
          onMouseDown={handleStartDrag}
          style={{ cursor: isPositionLocked ? "default" : "grab" }}
        >
          <div
            className="header-left"
            onMouseDown={handleStartDrag}
            style={{ cursor: isPositionLocked ? "default" : "grab" }}
          >
            {taskLists.length > 1 ? (
              <div className="list-select-wrapper" onClick={(e) => e.stopPropagation()}>
                <select
                  className="list-select"
                  value={selectedListId}
                  onChange={(e) => setSelectedListId(e.target.value)}
                  title="Обрати список Google Tasks"
                >
                  {taskLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </select>
                <ChevronDown size={11} className="list-select-chevron" />
              </div>
            ) : (
              <span className="header-title">Google Tasks</span>
            )}

            <span className="badge-count" title="Кількість активних завдань">
              {activeTab === "starred" ? starredActiveCount : allActiveCount}
            </span>

            <button
              type="button"
              className="action-icon-btn lock-toggle-btn"
              onClick={async (e) => {
                e.stopPropagation();
                const nextLocked = !isPositionLocked;
                setIsPositionLocked(nextLocked);
                tasksService.saveConfig({ isPositionLocked: nextLocked });
                invoke("set_window_resizable", { resizable: !nextLocked }).catch(() => {});
                if (nextLocked) {
                  try {
                    const [x, y] = await invoke<[number, number]>("get_window_position");
                    localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
                  } catch {}
                }
              }}
              title={
                isPositionLocked
                  ? "Положення та розмір зафіксовано (клікніть, щоб розблокувати)"
                  : "Клікніть, щоб зафіксувати положення та розмір віджета"
              }
              style={{
                marginLeft: 4,
                width: 22,
                height: 22,
                padding: 0,
                background: isPositionLocked
                  ? "rgba(66, 133, 244, 0.22)"
                  : "rgba(255, 255, 255, 0.06)",
                border: isPositionLocked
                  ? "1px solid rgba(66, 133, 244, 0.5)"
                  : "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "5px",
                color: isPositionLocked ? "#8ab4f8" : "rgba(255,255,255,0.45)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {isPositionLocked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
          </div>

          <div className="header-actions">
            <div
              className="size-presets"
              style={{
                opacity: isPositionLocked ? 0.45 : 1,
                cursor: isPositionLocked ? "not-allowed" : "pointer",
              }}
            >
              <button
                className={`size-btn ${activeSize === "S" ? "active" : ""}`}
                onClick={() => handleSetSize("S")}
                disabled={isPositionLocked}
                title={isPositionLocked ? "Розмір зафіксовано замком" : "Компактний (290x380)"}
              >
                S
              </button>
              <button
                className={`size-btn ${activeSize === "M" ? "active" : ""}`}
                onClick={() => handleSetSize("M")}
                disabled={isPositionLocked}
                title={isPositionLocked ? "Розмір зафіксовано замком" : "Середній (330x460)"}
              >
                M
              </button>
              <button
                className={`size-btn ${activeSize === "L" ? "active" : ""}`}
                onClick={() => handleSetSize("L")}
                disabled={isPositionLocked}
                title={isPositionLocked ? "Розмір зафіксовано замком" : "Великий (380x560)"}
              >
                L
              </button>
            </div>

            <button
              className="action-icon-btn"
              onClick={loadTasks}
              title="Синхронізувати з Google Tasks"
              disabled={isLoading}
            >
              <RefreshCw size={13} className={isLoading ? "spin" : ""} />
            </button>

            <button
              className="action-icon-btn"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              title={isSettingsOpen ? "Закрити налаштування" : "Налаштування"}
            >
              <Settings size={13} />
            </button>

            <button
              className="action-icon-btn"
              onClick={() => invoke("hide_window")}
              title="Згорнути у трей (клік по іконці в треї поверне віджет)"
            >
              <Minus size={13} />
            </button>
          </div>
        </div>

        {/* Google Navigation Tabs ("Усі завдання" vs "Із зірочкою") */}
        <div className="google-nav-tabs">
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "all" ? "active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            <Check size={12} />
            <span>Усі завдання</span>
            <span className="tab-badge">{allActiveCount}</span>
          </button>
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "starred" ? "active" : ""}`}
            onClick={() => setActiveTab("starred")}
          >
            <Star
              size={12}
              fill={activeTab === "starred" || starredActiveCount > 0 ? "#8ab4f8" : "none"}
              color={activeTab === "starred" || starredActiveCount > 0 ? "#8ab4f8" : "currentColor"}
            />
            <span>Із зірочкою</span>
            {starredActiveCount > 0 && (
              <span className="tab-badge starred">{starredActiveCount}</span>
            )}
          </button>
        </div>

        {/* Task List (Active + Collapsible Completed) */}
        <div className="task-list">
          {activeTasks.length === 0 && completedTasks.length === 0 ? (
            <div className="empty-state">
              {activeTab === "starred" ? (
                <>
                  <Star size={28} color="#8ab4f8" />
                  <span>Немає завдань із зірочкою</span>
                </>
              ) : (
                <>
                  <Inbox size={28} />
                  <span>Усі завдання виконано!</span>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Active Tasks */}
              {activeTasks.map((task) => (
                <div
                  key={task.id}
                  className={`task-row ${task.starred ? "starred-task" : ""}`}
                >
                  {/* Circle Checkbox (ONLY THIS completes the task!) */}
                  <button
                    type="button"
                    className="google-checkbox"
                    onClick={(e) => handleToggleTaskStatus(task, e)}
                    title="Позначити виконаним"
                  >
                    <Check className="check-icon" />
                  </button>

                  {/* Task Content (Clicking opens inline edit, NOT completes) */}
                  <div
                    className="task-body"
                    onClick={() => handleStartEdit(task)}
                    title="Натисніть для редагування"
                  >
                    {editingTaskId === task.id ? (
                      <div
                        className="inline-edit-wrapper"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <textarea
                          className="inline-edit-textarea"
                          value={editingTitle}
                          autoFocus
                          rows={2}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSaveEdit(task.id);
                            } else if (e.key === "Escape") {
                              setEditingTaskId(null);
                            }
                          }}
                          onBlur={() => handleSaveEdit(task.id)}
                        />
                        <div className="edit-hints">
                          Enter — зберегти, Esc — скасувати
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="task-title">{task.title}</div>
                        {task.notes && (
                          <div className="task-notes">{task.notes}</div>
                        )}
                        {task.due && (
                          <div className="task-badges">
                            <span
                              className={`badge-due ${
                                isPastDue(task.due, task.dueTime) ? "overdue" : "today"
                              }`}
                              title={
                                task.dueTime
                                  ? `Термін: ${formatDueDate(task.due, task.dueTime)}`
                                  : `Термін: ${formatDueDate(task.due)}`
                              }
                            >
                              {task.dueTime ? <Clock size={9} /> : <Calendar size={9} />}
                              {formatDueDate(task.due, task.dueTime)}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="task-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="task-del-btn"
                      onClick={(e) => handleStartEdit(task, e)}
                      title="Редагувати текст"
                    >
                      <Edit2 size={11} />
                    </button>
                    <button
                      type="button"
                      className="task-del-btn"
                      onClick={(e) => handleDeleteTask(task.id, e)}
                      title="Видалити завдання"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {/* Star Toggle Button */}
                  <button
                    type="button"
                    className={`task-star-btn ${task.starred ? "starred" : ""}`}
                    onClick={(e) => handleToggleStar(task.id, e)}
                    title={task.starred ? "Зняти зірочку" : "Позначити зірочкою"}
                  >
                    <Star
                      size={15}
                      fill={task.starred ? "#8ab4f8" : "none"}
                      color={task.starred ? "#8ab4f8" : "rgba(255, 255, 255, 0.35)"}
                    />
                  </button>
                </div>
              ))}

              {/* Collapsible Completed Section */}
              {completedTasks.length > 0 && (
                <div className="completed-section">
                  <button
                    type="button"
                    className="completed-header"
                    onClick={() => setIsCompletedOpen(!isCompletedOpen)}
                  >
                    <ChevronDown
                      size={14}
                      className={`completed-chevron ${
                        isCompletedOpen ? "rotated" : ""
                      }`}
                    />
                    <span>Виконано ({completedTasks.length})</span>
                  </button>

                  {isCompletedOpen && (
                    <div className="completed-list">
                      {completedTasks.map((task) => (
                        <div
                          key={task.id}
                          className={`task-row completed ${task.starred ? "starred-task" : ""}`}
                        >
                          {/* Checkbox to UNCHECK / restore task */}
                          <button
                            type="button"
                            className="google-checkbox checked"
                            onClick={(e) => handleToggleTaskStatus(task, e)}
                            title="Повернути до невиконаних"
                          >
                            <Check className="check-icon visible" />
                          </button>

                          <div
                            className="task-body"
                            onClick={() => handleStartEdit(task)}
                          >
                            <div className="task-title completed">
                              {task.title}
                            </div>
                            {task.notes && (
                              <div className="task-notes completed">
                                {task.notes}
                              </div>
                            )}
                            {task.due && (
                              <div className="task-badges">
                                <span className="badge-due" style={{ opacity: 0.7 }}>
                                  {task.dueTime ? <Clock size={9} /> : <Calendar size={9} />}
                                  {formatDueDate(task.due, task.dueTime)}
                                </span>
                              </div>
                            )}
                          </div>

                          <div
                            className="task-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="task-del-btn"
                              onClick={(e) => handleDeleteTask(task.id, e)}
                              title="Видалити назавжди"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>

                          {/* Star Toggle Button for Completed Tasks */}
                          <button
                            type="button"
                            className={`task-star-btn ${task.starred ? "starred" : ""}`}
                            onClick={(e) => handleToggleStar(task.id, e)}
                            title={task.starred ? "Зняти зірочку" : "Позначити зірочкою"}
                          >
                            <Star
                              size={15}
                              fill={task.starred ? "#8ab4f8" : "none"}
                              color={task.starred ? "#8ab4f8" : "rgba(255, 255, 255, 0.35)"}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Quick Add with Date & Time Picker */}
        <div className="widget-footer">
          {isDatePickerOpen && (
            <div className="date-popover">
              <div className="popover-header">
                <span className="popover-title">Термін та час завдання:</span>
                <button
                  type="button"
                  className="popover-close-btn"
                  onClick={() => setIsDatePickerOpen(false)}
                  title="Закрити"
                >
                  <X size={12} />
                </button>
              </div>

              {/* Quick Date Presets */}
              <div className="date-popover-row">
                <button
                  type="button"
                  className={`date-quick-btn ${tempDate === getTodayStr() ? "active" : ""}`}
                  onClick={() => setTempDate(getTodayStr())}
                >
                  Сьогодні
                </button>
                <button
                  type="button"
                  className={`date-quick-btn ${tempDate === getFutureDateStr(1) ? "active" : ""}`}
                  onClick={() => setTempDate(getFutureDateStr(1))}
                >
                  Завтра
                </button>
                <button
                  type="button"
                  className={`date-quick-btn ${tempDate === getFutureDateStr(7) ? "active" : ""}`}
                  onClick={() => setTempDate(getFutureDateStr(7))}
                >
                  Через тиждень
                </button>
              </div>

              {/* Date Input */}
              <div className="popover-field">
                <label className="popover-field-label">
                  <Calendar size={11} /> Дата:
                </label>
                <input
                  type="date"
                  className="date-custom-input"
                  value={tempDate}
                  onChange={(e) => setTempDate(e.target.value)}
                />
              </div>

              {/* Time Section */}
              <div className="popover-field">
                <div className="popover-field-header">
                  <label className="popover-field-label">
                    <Clock size={11} /> Час (необов'язково):
                  </label>
                  {tempTime && (
                    <button
                      type="button"
                      className="popover-clear-link"
                      onClick={() => setTempTime("")}
                      title="Прибрати час"
                    >
                      Прибрати час
                    </button>
                  )}
                </div>

                {/* Quick Time Presets */}
                <div className="time-chips-row">
                  {["09:00", "13:00", "18:00", "21:00"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`time-chip ${tempTime === t ? "active" : ""}`}
                      onClick={() => setTempTime(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Time Input */}
                <input
                  type="time"
                  className="date-custom-input time-custom-input"
                  value={tempTime}
                  onChange={(e) => setTempTime(e.target.value)}
                />
              </div>

              {/* Actions Footer */}
              <div className="popover-actions-row">
                <button
                  type="button"
                  className="popover-btn-secondary"
                  onClick={handleClearDue}
                >
                  Очистити
                </button>
                <button
                  type="button"
                  className="popover-btn-primary"
                  onClick={handleApplyDue}
                >
                  Застосувати
                </button>
              </div>
            </div>
          )}

          <form className="quick-add-form" onSubmit={handleCreateTask}>
            <button
              type="button"
              className={`date-picker-btn ${selectedDue ? "active" : ""}`}
              onClick={handleOpenDatePicker}
              title="Встановити термін та час"
            >
              {selectedDueTime ? <Clock size={13} /> : <Calendar size={13} />}
            </button>

            {selectedDue && (
              <span className="selected-due-badge">
                {selectedDueTime ? (
                  <Clock size={10} style={{ marginRight: 3 }} />
                ) : (
                  <Calendar size={10} style={{ marginRight: 3 }} />
                )}
                {formatDueDate(selectedDue, selectedDueTime || undefined)}
                <button
                  type="button"
                  className="clear-due-btn"
                  onClick={handleClearDue}
                  title="Прибрати термін"
                >
                  <X size={10} />
                </button>
              </span>
            )}

            <input
              type="text"
              className="quick-add-input"
              placeholder={
                activeTab === "starred"
                  ? "+ Нове завдання із зірочкою..."
                  : "+ Нове завдання..."
              }
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
            />

            <button
              type="submit"
              className="quick-add-submit"
              disabled={!newTaskTitle.trim()}
              title="Додати завдання (Enter)"
            >
              <Plus size={13} />
            </button>
          </form>

          {/* Resize corner grip */}
          {!isPositionLocked && (
            <div
              className="resize-grip"
              title="Потягніть для зміни розміру або використовуйте кнопки S / M / L вгорі"
            >
              <svg viewBox="0 0 10 10">
                <path
                  d="M9 1L1 9M9 5L5 9M9 9L9 9"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Settings Modal */}
        {isSettingsOpen && (
          <ErrorBoundary onReset={() => setIsSettingsOpen(false)}>
            <SettingsModal
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
              onConfigUpdated={() => {
                loadTasks();
                setIsPositionLocked(tasksService.getConfig().isPositionLocked || false);
              }}
              toggleAlwaysOnTop={() => {}}
            />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}

export default App;
