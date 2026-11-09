import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  ChevronDown,
} from "lucide-react";
import "./App.css";

export function App() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [activeListId, setActiveListId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isListMenuOpen, setIsListMenuOpen] = useState(false);
  const [activeSize, setActiveSize] = useState<"S" | "M" | "L">("S");
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(
    tasksService.getConfig().alwaysOnTop
  );

  // Load lists
  const loadLists = useCallback(async () => {
    setIsLoading(true);
    try {
      const fetchedLists = await tasksService.getTaskLists();
      setLists(fetchedLists);
      if (fetchedLists.length > 0) {
        setActiveListId((prev) => (prev ? prev : fetchedLists[0].id));
      }
    } catch (err) {
      console.error("Failed loading lists", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load tasks for active list
  const loadTasks = useCallback(async (listId: string) => {
    if (!listId) return;
    setIsLoading(true);
    try {
      const fetchedTasks = await tasksService.getTasks(listId);
      setTasks(fetchedTasks);
    } catch (err) {
      console.error("Failed loading tasks", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (activeListId) {
      loadTasks(activeListId);
    }
  }, [activeListId, loadTasks]);

  // Window drag handler
  const handleStartDrag = async (e: React.MouseEvent) => {
    // Only drag on left click and when not clicking a button/input
    if (e.button === 0 && !(e.target as HTMLElement).closest("button, input, form")) {
      try {
        await invoke("start_dragging");
      } catch (err) {
        console.warn("start_dragging error", err);
      }
    }
  };

  // Window actions via Tauri Rust backend
  const handleClose = async () => {
    try {
      await invoke("close_window");
    } catch (e) {
      console.warn("close_window error", e);
    }
  };

  const handleMinimize = async () => {
    try {
      await invoke("minimize_window");
    } catch (e) {
      console.warn("minimize_window error", e);
    }
  };

  const handleToggleAlwaysOnTop = async (value?: boolean) => {
    const nextVal = value !== undefined ? value : !isAlwaysOnTop;
    setIsAlwaysOnTop(nextVal);
    tasksService.saveConfig({ alwaysOnTop: nextVal });
    try {
      await invoke("set_always_on_top", { alwaysOnTop: nextVal });
    } catch (e) {
      console.warn("set_always_on_top error", e);
    }
  };

  // Preset sizes for laptops / compact screens
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

  // Toggle task completion
  const handleToggleTask = async (task: Task) => {
    const isCompleted = task.status === "completed";
    const nextStatus = isCompleted ? "needsAction" : "completed";

    // Optimistic UI update
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t))
    );

    await tasksService.setTaskStatus(task.listId, task.id, !isCompleted);
  };

  // Add new task
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title || !activeListId) return;

    setNewTaskTitle("");
    const created = await tasksService.createTask(activeListId, title);
    setTasks((prev) => [created, ...prev]);
  };

  // Delete task
  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (activeListId) {
      await tasksService.deleteTask(activeListId, taskId);
    }
  };

  const activeTasksCount = tasks.filter((t) => t.status === "needsAction").length;
  const currentList = lists.find((l) => l.id === activeListId);

  return (
    <div className="widget-frame" onMouseDown={handleStartDrag}>
      <div className="glass-container">
        {/* Header - Circular controls only */}
        <div className="widget-header" onMouseDown={handleStartDrag}>
          <div className="traffic-lights">
            <button
              className="traffic-btn close"
              onClick={handleClose}
              title="Закрити"
            />
            <button
              className="traffic-btn minimize"
              onClick={handleMinimize}
              title="Згорнути"
            />
            <button
              className={`traffic-btn pin ${isAlwaysOnTop ? "active" : ""}`}
              onClick={() => handleToggleAlwaysOnTop()}
              title={
                isAlwaysOnTop
                  ? "Режим: Поверх усіх вікон (Клікніть, щоб закріпити на робочому столі)"
                  : "Режим: Закріплено на робочому столі (Клікніть, щоб закріпити поверх усіх)"
              }
            />
          </div>

          <div className="header-center" onMouseDown={handleStartDrag}>
            <span className="header-title">Google Tasks</span>
            <span className="badge-count">{activeTasksCount}</span>
          </div>

          <div className="header-actions">
            <button
              className={`action-icon-btn ${isLoading ? "spinning" : ""}`}
              onClick={() => {
                if (activeListId) loadTasks(activeListId);
              }}
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

        {/* Minimal List Bar & Size Presets (S / M / L) */}
        <div className="list-bar">
          <button
            className="list-dropdown-btn"
            onClick={() => setIsListMenuOpen(!isListMenuOpen)}
          >
            <span>{currentList ? currentList.title : "Списки"}</span>
            <ChevronDown size={12} />
          </button>

          <div className="size-presets">
            <button
              className={`size-btn ${activeSize === "S" ? "active" : ""}`}
              onClick={() => handleSetSize("S")}
              title="Маленький компактний розмір (290x380)"
            >
              S
            </button>
            <button
              className={`size-btn ${activeSize === "M" ? "active" : ""}`}
              onClick={() => handleSetSize("M")}
              title="Середній розмір (330x460)"
            >
              M
            </button>
            <button
              className={`size-btn ${activeSize === "L" ? "active" : ""}`}
              onClick={() => handleSetSize("L")}
              title="Великий розмір (380x560)"
            >
              L
            </button>
          </div>
        </div>

        {/* Dropdown Menu for Task Lists */}
        {isListMenuOpen && (
          <div className="lists-menu">
            {lists.map((l) => (
              <div
                key={l.id}
                className={`lists-menu-item ${
                  l.id === activeListId ? "active" : ""
                }`}
                onClick={() => {
                  setActiveListId(l.id);
                  setIsListMenuOpen(false);
                }}
              >
                <span>{l.title}</span>
                {l.id === activeListId && <Check size={12} />}
              </div>
            ))}
          </div>
        )}

        {/* Tasks List - Sleek Clean Lines */}
        <div className="tasks-container">
          {tasks.length === 0 ? (
            <div className="empty-state">
              <Inbox />
              <span>Немає завдань у цьому списку</span>
            </div>
          ) : (
            tasks.map((task) => {
              const isDone = task.status === "completed";
              return (
                <div
                  key={task.id}
                  className={`task-row ${isDone ? "completed" : ""}`}
                  onClick={() => handleToggleTask(task)}
                >
                  <div className={`apple-checkbox ${isDone ? "checked" : ""}`}>
                    {isDone && <Check />}
                  </div>

                  <div className="task-body">
                    <span className="task-title">{task.title}</span>
                    {task.notes && (
                      <span className="task-notes">{task.notes}</span>
                    )}
                    {task.due && !isDone && (
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
                    className="task-del-btn"
                    onClick={(e) => handleDeleteTask(task.id, e)}
                    title="Видалити"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Quick Add with Round Button */}
        <div className="widget-footer">
          <form className="quick-add-form" onSubmit={handleCreateTask}>
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
              title="Додати"
            >
              <Plus size={12} />
            </button>
          </form>

          {/* Resize corner grip */}
          <div
            className="resize-grip"
            title="Потягніть для зміни розміру або використовуйте кнопки S / M / L вгорі"
          >
            <svg viewBox="0 0 10 10">
              <path d="M9 1L1 9M9 5L5 9M9 9L9 9" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {/* Settings Modal */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onConfigUpdated={() => {
            loadLists();
            if (activeListId) loadTasks(activeListId);
          }}
          toggleAlwaysOnTop={handleToggleAlwaysOnTop}
        />
      </div>
    </div>
  );
}

export default App;
