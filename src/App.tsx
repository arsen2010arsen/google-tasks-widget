import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Task } from "./types";
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
} from "lucide-react";
import "./App.css";

const POS_KEY = "g_tasks_window_position";

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [selectedDue, setSelectedDue] = useState<string | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSize, setActiveSize] = useState<"S" | "M" | "L">("S");
  const [isPositionLocked, setIsPositionLocked] = useState<boolean>(
    tasksService.getConfig().isPositionLocked || false
  );

  // Inline editing state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Load active tasks
  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const fetchedTasks = await tasksService.getAllTasks();
      setTasks(fetchedTasks);
      setIsPositionLocked(tasksService.getConfig().isPositionLocked || false);
    } catch (err) {
      console.error("Failed loading tasks", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Restore saved window position on startup
  useEffect(() => {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      try {
        const { x, y } = JSON.parse(raw);
        invoke("set_window_position", { x: Number(x), y: Number(y) }).catch(() => {});
      } catch {}
    }
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
    if (e.button === 0 && !(e.target as HTMLElement).closest("button, input, form")) {
      try {
        await invoke("start_dragging");
        // Save new position after dragging completes
        setTimeout(async () => {
          try {
            const [x, y] = await invoke<[number, number]>("get_window_position");
            localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
          } catch {}
        }, 500);
      } catch (err) {
        console.warn("start_dragging error", err);
      }
    }
  };

  // Close hides to system tray
  const handleClose = async () => {
    try {
      await invoke("hide_window");
    } catch (e) {
      console.warn("hide_window error", e);
    }
  };

  const handleMinimize = async () => {
    try {
      await invoke("minimize_window");
    } catch (e) {
      console.warn("minimize_window error", e);
    }
  };

  // Preset sizes
  const handleSetSize = async (size: "S" | "M" | "L") => {
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

  // Complete task - immediately removes it from the list
  const handleCompleteTask = async (task: Task) => {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      await tasksService.setTaskStatus(task.id, true);
    } catch (err) {
      console.error("Failed to complete task", err);
    }
  };

  // Add new task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;

    setNewTaskTitle("");
    const dueToSave = selectedDue;
    setSelectedDue(null);
    setIsDatePickerOpen(false);

    try {
      const created = await tasksService.createTask(title, dueToSave || undefined);
      setTasks((prev) => [created, ...prev]);
    } catch (err) {
      console.error("Failed to create task", err);
    }
  };

  // Inline editing save
  const handleStartEdit = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTaskId(task.id);
    setEditingTitle(task.title);
  };

  const handleSaveEdit = async (taskId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, title: trimmed } : t))
      );
      await tasksService.updateTask(taskId, trimmed);
    }
    setEditingTaskId(null);
  };

  // Delete task
  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await tasksService.deleteTask(taskId);
  };

  // Quick date pickers
  const setQuickDate = (daysFromNow: number) => {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    date.setHours(23, 59, 59, 0);
    setSelectedDue(date.toISOString());
    setIsDatePickerOpen(false);
  };

  const handleCustomDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      const date = new Date(e.target.value + "T23:59:59.000Z");
      setSelectedDue(date.toISOString());
      setIsDatePickerOpen(false);
    }
  };

  const activeTasksCount = tasks.length;

  return (
    <div className="widget-frame">
      <div className="glass-container">
        {/* Header - draggable ONLY when not locked */}
        <div
          className={`widget-header ${isPositionLocked ? "locked" : ""}`}
          onMouseDown={handleStartDrag}
          style={{ cursor: isPositionLocked ? "default" : "grab" }}
        >
          <div className="traffic-lights">
            <button
              className="traffic-btn close"
              onClick={handleClose}
              title="Сховати в трей"
            />
            <button
              className="traffic-btn minimize"
              onClick={handleMinimize}
              title="Згорнути"
            />
          </div>

          <div
            className="header-center"
            onMouseDown={handleStartDrag}
            style={{ cursor: isPositionLocked ? "default" : "grab" }}
          >
            <span className="header-title">Google Tasks</span>
            <span className="badge-count">{activeTasksCount}</span>
            {isPositionLocked && (
              <span title="Положення заблоковано в налаштуваннях" style={{ display: "inline-flex", alignItems: "center" }}>
                <Lock size={10} color="#8ab4f8" style={{ opacity: 0.7 }} />
              </span>
            )}
          </div>

          <div className="header-actions">
            <div className="size-presets">
              <button
                className={`size-btn ${activeSize === "S" ? "active" : ""}`}
                onClick={() => handleSetSize("S")}
                title="Компактний (290x380)"
              >
                S
              </button>
              <button
                className={`size-btn ${activeSize === "M" ? "active" : ""}`}
                onClick={() => handleSetSize("M")}
                title="Середній (330x460)"
              >
                M
              </button>
              <button
                className={`size-btn ${activeSize === "L" ? "active" : ""}`}
                onClick={() => handleSetSize("L")}
                title="Великий (380x560)"
              >
                L
              </button>
            </div>

            <button
              className={`action-icon-btn ${isLoading ? "spinning" : ""}`}
              onClick={loadTasks}
              title="Оновити задачі"
            >
              <RefreshCw size={11} />
            </button>
            <button
              className="action-icon-btn"
              onClick={() => setIsSettingsOpen(true)}
              title="Налаштування"
            >
              <Settings size={11} />
            </button>
          </div>
        </div>

        {/* Tasks List */}
        <div className="tasks-container">
          {tasks.length === 0 ? (
            <div className="empty-state">
              <Inbox />
              <span>Усі завдання виконано!</span>
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                className="task-row"
                onClick={() => {
                  if (editingTaskId !== task.id) handleCompleteTask(task);
                }}
              >
                <button
                  type="button"
                  className="apple-checkbox"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCompleteTask(task);
                  }}
                  title="Позначити виконаним (видалити зі списку)"
                >
                  <Check />
                </button>

                <div className="task-body">
                  {editingTaskId === task.id ? (
                    <input
                      type="text"
                      className="inline-edit-input"
                      value={editingTitle}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit(task.id);
                        if (e.key === "Escape") setEditingTaskId(null);
                      }}
                      onBlur={() => handleSaveEdit(task.id)}
                    />
                  ) : (
                    <span
                      className="task-title"
                      title="Клікніть двічі для редагування"
                      onDoubleClick={(e) => handleStartEdit(task, e)}
                    >
                      {task.title}
                    </span>
                  )}

                  {task.notes && (
                    <span className="task-notes">{task.notes}</span>
                  )}
                  {task.due && (
                    <div className="task-badges">
                      <span className="badge-due today">
                        <Calendar size={9} />
                        {new Date(task.due).toLocaleDateString("uk-UA", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="task-del-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleStartEdit(task, e)}
                  title="Редагувати текст"
                >
                  <Edit2 size={11} />
                </button>

                <button
                  type="button"
                  className="task-del-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleDeleteTask(task.id, e)}
                  title="Видалити завдання"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer Quick Add with Date Picker */}
        <div className="widget-footer">
          {isDatePickerOpen && (
            <div className="date-popover">
              <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.6)", marginBottom: 2 }}>
                Встановити термін завдання:
              </div>
              <div className="date-popover-row">
                <button
                  type="button"
                  className="date-quick-btn"
                  onClick={() => setQuickDate(0)}
                >
                  Сьогодні
                </button>
                <button
                  type="button"
                  className="date-quick-btn"
                  onClick={() => setQuickDate(1)}
                >
                  Завтра
                </button>
                <button
                  type="button"
                  className="date-quick-btn"
                  onClick={() => setQuickDate(7)}
                >
                  Через тиждень
                </button>
              </div>
              <input
                type="date"
                className="date-custom-input"
                onChange={handleCustomDateChange}
              />
            </div>
          )}

          <form className="quick-add-form" onSubmit={handleCreateTask}>
            <button
              type="button"
              className={`date-picker-btn ${selectedDue ? "active" : ""}`}
              onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
              title="Встановити термін (дедлайн)"
            >
              <Calendar size={13} />
            </button>

            {selectedDue && (
              <span className="selected-due-badge">
                {new Date(selectedDue).toLocaleDateString("uk-UA", {
                  day: "numeric",
                  month: "short",
                })}
                <button
                  type="button"
                  className="clear-due-btn"
                  onClick={() => setSelectedDue(null)}
                  title="Прибрати термін"
                >
                  <X size={10} />
                </button>
              </span>
            )}

            <input
              type="text"
              className="quick-add-input"
              placeholder="+ Нове завдання..."
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
            />

            <button
              type="submit"
              className="quick-add-submit"
              disabled={!newTaskTitle.trim()}
              title="Додати завдання"
            >
              <Plus size={12} />
            </button>
          </form>

          {/* Resize corner grip */}
          {!isPositionLocked && (
            <div
              className="resize-grip"
              title="Потягніть для зміни розміру або використовуйте кнопки S / M / L вгорі"
            >
              <svg viewBox="0 0 10 10">
                <path d="M9 1L1 9M9 5L5 9M9 9L9 9" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          )}
        </div>

        {/* Settings Modal */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onConfigUpdated={() => {
            loadTasks();
            setIsPositionLocked(tasksService.getConfig().isPositionLocked || false);
          }}
          toggleAlwaysOnTop={() => {}}
        />
      </div>
    </div>
  );
}

export default App;
