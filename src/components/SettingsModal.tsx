import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppConfig } from "../types";
import { tasksService } from "../services/googleTasks";
import { X, HelpCircle, LogIn, Power, Monitor, Lock } from "lucide-react";

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
}) => {
  const [config, setConfig] = useState<AppConfig>(tasksService.getConfig());
  const [showHelp, setShowHelp] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setConfig(tasksService.getConfig());
      invoke<boolean>("get_autostart")
        .then((val) => setAutostart(val))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    tasksService.saveConfig(config);
    onConfigUpdated();
    onClose();
  };

  const handleToggleAutostart = async (checked: boolean) => {
    setAutostart(checked);
    try {
      await invoke("set_autostart", { enabled: checked });
    } catch (err) {
      console.warn("Failed to set autostart", err);
    }
  };

  const handleOneClickLogin = async () => {
    if (!config.clientId || !config.clientSecret) {
      setAuthError("Спочатку введіть Client ID та Client Secret нижче");
      return;
    }

    setAuthError(null);
    setIsLoggingIn(true);
    tasksService.saveConfig(config);

    try {
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
        config.clientId
      )}&redirect_uri=http://127.0.0.1:8085&response_type=code&scope=https://www.googleapis.com/auth/tasks&access_type=offline&prompt=consent`;

      window.open(authUrl, "_blank");

      const code = await invoke<string>("wait_for_oauth_code");
      await tasksService.exchangeCodeForTokens(code);

      setConfig(tasksService.getConfig());
      onConfigUpdated();
      setIsLoggingIn(false);
      onClose();
    } catch (err: any) {
      setAuthError(err?.message || "Помилка авторизації");
      setIsLoggingIn(false);
    }
  };

  const handleExitApp = async () => {
    try {
      await invoke("exit_app");
    } catch (err) {
      console.warn("exit_app error", err);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-header">
        <div className="modal-title">Налаштування віджета</div>
        <button className="action-icon-btn" onClick={onClose} title="Закрити">
          <X size={15} />
        </button>
      </div>

      <div className="modal-body">
        {/* 1-Click Google Login Button */}
        <div style={{ background: "rgba(66, 133, 244, 0.12)", border: "1px solid rgba(66, 133, 244, 0.3)", padding: "10px", borderRadius: "10px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 600, color: "#8ab4f8", fontSize: "12px" }}>
              Вхід у Google Tasks
            </span>
            {config.accessToken && !config.useMockData && (
              <span style={{ color: "#34a853", fontSize: "10.5px", fontWeight: 600 }}>
                ● Підключено
              </span>
            )}
          </div>
          <p style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.6)", lineHeight: "1.3" }}>
            Натисніть для авторизації в 1 клік через ваш браузер без ручного копіювання токенів.
          </p>
          <button
            onClick={handleOneClickLogin}
            disabled={isLoggingIn}
            style={{
              background: "#1a73e8",
              color: "#fff",
              border: "none",
              borderRadius: "7px",
              padding: "7px 10px",
              fontSize: "11.5px",
              fontWeight: 600,
              cursor: isLoggingIn ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              opacity: isLoggingIn ? 0.7 : 1,
            }}
          >
            <LogIn size={13} />
            {isLoggingIn ? "Очікування входу в браузері..." : "Увійти через Google"}
          </button>
          {authError && (
            <div style={{ color: "#ff453a", fontSize: "10.5px" }}>{authError}</div>
          )}
        </div>

        {/* Lock Position Toggle */}
        <div className="setting-row">
          <div>
            <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
              <Lock size={12} /> Закріпити положення (заблокувати рух)
            </div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)" }}>
              Забороняє перетягування віджета по екрану
            </div>
          </div>
          <input
            type="checkbox"
            checked={config.isPositionLocked}
            onChange={(e) =>
              setConfig({ ...config, isPositionLocked: e.target.checked })
            }
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
        </div>

        {/* Autostart toggle */}
        <div className="setting-row">
          <div>
            <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
              <Monitor size={12} /> Запускати разом з Windows
            </div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)" }}>
              Віджет відкриватиметься на робочому столі при старті ПК
            </div>
          </div>
          <input
            type="checkbox"
            checked={autostart}
            onChange={(e) => handleToggleAutostart(e.target.checked)}
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
        </div>

        {/* Mock mode toggle */}
        <div className="setting-row">
          <div>
            <div style={{ fontWeight: 600 }}>Демо-режим (Тестові задачі)</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)" }}>
              Працювати офлайн із локальними завданнями
            </div>
          </div>
          <input
            type="checkbox"
            checked={config.useMockData}
            onChange={(e) =>
              setConfig({ ...config, useMockData: e.target.checked })
            }
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
        </div>

        {/* Google API credentials section */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <span className="setting-label" style={{ fontWeight: 600, color: "#8ab4f8" }}>
            Google Cloud Console Ключі
          </span>
          <button
            onClick={() => setShowHelp(!showHelp)}
            style={{ background: "transparent", border: "none", color: "#8ab4f8", cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontSize: "10.5px" }}
          >
            <HelpCircle size={11} /> Інструкція
          </button>
        </div>

        {showHelp && (
          <div style={{ background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.1)", padding: 8, borderRadius: 8, fontSize: "10.5px", lineHeight: "1.4" }}>
            1. Зайдіть у <b>console.cloud.google.com</b><br />
            2. Увімкніть <b>Google Tasks API</b><br />
            3. Створіть <b>OAuth Client ID</b> (Desktop Application)<br />
            4. Вставте сюди Client ID та Client Secret.
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

        <button className="save-btn" onClick={handleSave}>
          Зберегти налаштування
        </button>

        {/* Complete Exit */}
        <button
          onClick={handleExitApp}
          style={{
            background: "transparent",
            color: "rgba(255, 59, 48, 0.8)",
            border: "1px solid rgba(255, 59, 48, 0.3)",
            borderRadius: "8px",
            padding: "6px",
            fontSize: "11px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            marginTop: 4,
          }}
        >
          <Power size={12} /> Повністю вийти з програми
        </button>
      </div>
    </div>
  );
};
