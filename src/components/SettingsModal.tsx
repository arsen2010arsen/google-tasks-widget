import React, { useState } from "react";
import { AppConfig } from "../types";
import { tasksService } from "../services/googleTasks";
import { X, Pin, HelpCircle } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfigUpdated: () => void;
  toggleAlwaysOnTop: (enabled: boolean) => void;
}

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onConfigUpdated,
  toggleAlwaysOnTop,
}) => {
  const [config, setConfig] = useState<AppConfig>(tasksService.getConfig());
  const [showHelp, setShowHelp] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    tasksService.saveConfig(config);
    toggleAlwaysOnTop(config.alwaysOnTop);
    onConfigUpdated();
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-header">
        <div className="modal-title">Налаштування віджета</div>
        <button
          className="action-icon-btn"
          onClick={onClose}
          title="Закрити"
        >
          <X size={15} />
        </button>
      </div>

      <div className="modal-body">
        {/* Mock mode toggle */}
        <div className="setting-row">
          <div>
            <div style={{ fontWeight: 600 }}>Демо-режим (Тестові задачі)</div>
            <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.5)" }}>
              Працює офлайн без авторизації Google
            </div>
          </div>
          <input
            type="checkbox"
            checked={config.useMockData}
            onChange={(e) =>
              setConfig({ ...config, useMockData: e.target.checked })
            }
            style={{ width: 18, height: 18, cursor: "pointer" }}
          />
        </div>

        {/* Pin on top toggle */}
        <div className="setting-row">
          <div>
            <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
              <Pin size={13} /> Завжди поверх інших вікон
            </div>
            <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.5)" }}>
              Вимкніть, щоб закріпити на рівні робочого столу
            </div>
          </div>
          <input
            type="checkbox"
            checked={config.alwaysOnTop}
            onChange={(e) =>
              setConfig({ ...config, alwaysOnTop: e.target.checked })
            }
            style={{ width: 18, height: 18, cursor: "pointer" }}
          />
        </div>

        {/* Google API credentials section */}
        <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="setting-label" style={{ fontWeight: 600, color: "#8ab4f8" }}>
            Google Cloud Console OAuth
          </span>
          <button
            onClick={() => setShowHelp(!showHelp)}
            style={{ background: "transparent", border: "none", color: "#8ab4f8", cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontSize: "11px" }}
          >
            <HelpCircle size={12} /> Як налаштувати?
          </button>
        </div>

        {showHelp && (
          <div style={{ background: "rgba(66, 133, 244, 0.12)", border: "1px solid rgba(66, 133, 244, 0.25)", padding: 8, borderRadius: 8, fontSize: "11px", lineHeight: "1.4" }}>
            1. Зайдіть у <b>console.cloud.google.com</b><br />
            2. Увімкніть <b>Google Tasks API</b><br />
            3. Створіть <b>OAuth Client ID</b> (Desktop Application)<br />
            4. Скопіюйте сюди Client ID та Client Secret.
          </div>
        )}

        <div className="setting-group">
          <label className="setting-label">Google Client ID</label>
          <input
            className="setting-input"
            type="text"
            placeholder="123456789-xxx.apps.googleusercontent.com"
            value={config.clientId}
            onChange={(e) => setConfig({ ...config, clientId: e.target.value })}
          />
        </div>

        <div className="setting-group">
          <label className="setting-label">Google Client Secret</label>
          <input
            className="setting-input"
            type="password"
            placeholder="GOCSPX-..."
            value={config.clientSecret}
            onChange={(e) =>
              setConfig({ ...config, clientSecret: e.target.value })
            }
          />
        </div>

        <div className="setting-group">
          <label className="setting-label">Прямий Access Token (Опціонально)</label>
          <input
            className="setting-input"
            type="password"
            placeholder="ya29.a0..."
            value={config.accessToken}
            onChange={(e) =>
              setConfig({ ...config, accessToken: e.target.value })
            }
          />
        </div>

        {/* Auto-refresh */}
        <div className="setting-group">
          <label className="setting-label">Інтервал автооновлення (хв)</label>
          <select
            className="setting-input"
            value={config.autoRefreshMinutes}
            onChange={(e) =>
              setConfig({
                ...config,
                autoRefreshMinutes: Number(e.target.value),
              })
            }
          >
            <option value={1} style={{ background: "#222" }}>1 хвилина</option>
            <option value={5} style={{ background: "#222" }}>5 хвилин</option>
            <option value={15} style={{ background: "#222" }}>15 хвилин</option>
            <option value={30} style={{ background: "#222" }}>30 хвилин</option>
          </select>
        </div>

        <button className="save-btn" onClick={handleSave}>
          Зберегти зміни
        </button>
      </div>
    </div>
  );
};
