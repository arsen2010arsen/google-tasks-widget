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
} from "lucide-react";
import "./App.css";

export function App() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [activeListId, setActiveListId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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

  // Window actions via Tauri Rust backend
  const handleClose = async () => {
    try {
      await invoke("close_window");
    } catch (e) {
      console.warn("Tauri close_window unavailable in browser mode", e);
    }
  };

  const handleMinimize = async () => {
    try {
      await invoke("minimize_window");
    } catch (e) {
      console.warn("Tauri minimize_window unavailable in browser mode", e);
    }
  };

  const handleToggleAlwaysOnTop = async (value?: boolean) => {
    const nextVal = value !== undefined ? value : !isAlwaysOnTop;
    setIsAlwaysOnTop(nextVal);
    tasksService.saveConfig({ alwaysOnTop: nextVal });
    try {
      await invoke("set_always_on_top", { alwaysOnTop: nextVal });
    } catch (e) {
      console.warn("Tauri set_always_on_top unavailable in browser mode", e);
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

  return (
    <div className="widget-frame">
      <div className="glass-container">
        {/* Header - macOS Traffic Lights & Title (Draggable region) */}
        <div className="widget-header" data-tauri-drag-region>
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

          <div className="header-center" data-tauri-drag-region>
            <div className="g-logo">
              <svg viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </div>
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
              <RefreshCw size={13} />
            </button>
            <button
              className="action-icon-btn"
              onClick={() => setIsSettingsOpen(true)}
              title="Налаштування"
            >
              <Settings size={13} />
            </button>
          </div>
        </div>

        {/* Task Lists Bar */}
        <div className="list-tabs-container">
          {lists.map((list) => (
            <div
              key={list.id}
              className={`list-tab-item ${
                list.id === activeListId ? "active" : ""
              }`}
              onClick={() => setActiveListId(list.id)}
            >
              {list.title}
            </div>
          ))}
        </div>

        {/* Tasks List */}
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
                          <Calendar size={10} />
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
                    title="Видалити завдання"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Quick Add */}
        <div className="widget-footer">
          <form className="quick-add-form" onSubmit={handleCreateTask}>
            <input
              type="text"
              className="quick-add-input"
              placeholder="+ Додати завдання у цей список..."
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
            />
            <button
              type="submit"
              className="quick-add-submit"
              disabled={!newTaskTitle.trim()}
              title="Додати"
            >
              <Plus size={14} />
            </button>
          </form>
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
