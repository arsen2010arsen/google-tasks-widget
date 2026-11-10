import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AppConfig } from "../types";
import { tasksService } from "../services/googleTasks";
import {
  X,
  HelpCircle,
  LogIn,
  LogOut,
  Power,
  Monitor,
  Lock,
  Unlock,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfigUpdated: () => void;
  toggleAlwaysOnTop?: (enabled: boolean) => void;
}

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onConfigUpdated,
}) => {
  const [config, setConfig] = useState<AppConfig>(() => {
    const c = tasksService.getConfig();
    return {
      ...c,
      clientId: c.clientId || "",
      clientSecret: c.clientSecret || "",
      isPositionLocked: !!c.isPositionLocked,
      useMockData: !!c.useMockData,
    };
  });
  const [showHelp, setShowHelp] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [currentAuthUrl, setCurrentAuthUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [positionNotice, setPositionNotice] = useState<string | null>(null);
  const [currentCoords, setCurrentCoords] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const c = tasksService.getConfig();
      setConfig({
        ...c,
        clientId: c.clientId || "",
        clientSecret: c.clientSecret || "",
        isPositionLocked: !!c.isPositionLocked,
        useMockData: !!c.useMockData,
      });
      setAuthError(null);
      setIsLoggingIn(false);
      setCurrentAuthUrl(null);
      invoke<boolean>("get_autostart")
        .then((val) => setAutostart(val))
        .catch(() => {});
      invoke<[number, number]>("get_window_position")
        .then(([x, y]) => setCurrentCoords({ x, y }))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    const trimmedConfig: AppConfig = {
      ...config,
      clientId: (config.clientId || "").trim(),
      clientSecret: (config.clientSecret || "").trim(),
    };
    tasksService.saveConfig(trimmedConfig);
    setConfig(trimmedConfig);
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
    const cleanClientId = (config.clientId || "").trim();
    const cleanClientSecret = (config.clientSecret || "").trim();

    if (!cleanClientId || !cleanClientSecret) {
      setAuthError("Будь ласка, вкажіть Client ID та Client Secret нижче");
      setShowHelp(true);
      return;
    }

    setAuthError(null);
    setIsLoggingIn(true);
    setCopiedUrl(false);

    // Save trimmed credentials first
    const updatedConfig: AppConfig = {
      ...config,
      clientId: cleanClientId,
      clientSecret: cleanClientSecret,
    };
    setConfig(updatedConfig);
    tasksService.saveConfig(updatedConfig);

    const redirectUri = "http://127.0.0.1:8085";
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
      cleanClientId
    )}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&scope=${encodeURIComponent(
      "https://www.googleapis.com/auth/tasks"
    )}&access_type=offline&prompt=consent`;

    setCurrentAuthUrl(authUrl);

    try {
      // 1. Start loopback listener in Rust first
      const codePromise = invoke<string>("wait_for_oauth_code");

      // 2. Open default browser via Tauri plugin opener, with cmd fallback
      try {
        await openUrl(authUrl);
      } catch (openerErr) {
        console.warn("openUrl failed, attempting fallback command", openerErr);
        await invoke("open_browser_url", { url: authUrl });
      }

      // 3. Await authorization code
      const code = await codePromise;

      // 4. Exchange code for access & refresh tokens
      await tasksService.exchangeCodeForTokens(code);

      setConfig(tasksService.getConfig());
      onConfigUpdated();
      setIsLoggingIn(false);
      setCurrentAuthUrl(null);
      onClose();
    } catch (err: any) {
      console.error("OAuth error:", err);
      const msg = typeof err === "string" ? err : err?.message || "Помилка авторизації";
      setAuthError(msg);
      setIsLoggingIn(false);
    }
  };

  const handleCancelLogin = async () => {
    try {
      await invoke("cancel_oauth_flow");
    } catch {}
    setIsLoggingIn(false);
    setCurrentAuthUrl(null);
  };

  const handleLogout = () => {
    tasksService.saveConfig({
      accessToken: "",
      refreshToken: "",
      useMockData: true,
    });
    setConfig(tasksService.getConfig());
    onConfigUpdated();
  };

  const handleCopyUrl = async () => {
    if (currentAuthUrl) {
      try {
        await navigator.clipboard.writeText(currentAuthUrl);
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      } catch (e) {
        console.warn("Clipboard write failed", e);
      }
    }
  };

  const handleOpenExternal = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      await invoke("open_browser_url", { url });
    }
  };

  const handleToggleLockPosition = async (checked: boolean) => {
    setConfig({ ...config, isPositionLocked: checked });
    tasksService.saveConfig({ isPositionLocked: checked });
    invoke("set_window_resizable", { resizable: !checked }).catch(() => {});
    onConfigUpdated();
    if (checked) {
      try {
        const [x, y] = await invoke<[number, number]>("get_window_position");
        localStorage.setItem("g_tasks_window_position", JSON.stringify({ x, y }));
        setCurrentCoords({ x, y });
        setPositionNotice(`Положення та розмір зафіксовано (X: ${x}, Y: ${y})!`);
        setTimeout(() => setPositionNotice(null), 2500);
      } catch {}
    } else {
      setPositionNotice("Розблоковано! Можна змінювати місце та розмір");
      setTimeout(() => setPositionNotice(null), 2500);
    }
  };

  const handleLockCurrentPosition = async () => {
    try {
      const [x, y] = await invoke<[number, number]>("get_window_position");
      localStorage.setItem("g_tasks_window_position", JSON.stringify({ x, y }));
      setCurrentCoords({ x, y });
      setConfig({ ...config, isPositionLocked: true });
      tasksService.saveConfig({ isPositionLocked: true });
      invoke("set_window_resizable", { resizable: false }).catch(() => {});
      onConfigUpdated();
      setPositionNotice(`Зафіксовано на X: ${x}, Y: ${y}!`);
      setTimeout(() => setPositionNotice(null), 3000);
    } catch (err) {
      console.warn("get_window_position error", err);
    }
  };

  const handleUnlockPosition = () => {
    setConfig({ ...config, isPositionLocked: false });
    tasksService.saveConfig({ isPositionLocked: false });
    invoke("set_window_resizable", { resizable: true }).catch(() => {});
    onConfigUpdated();
    setPositionNotice("Розблоковано! Можна вільно пересувати та змінювати розмір");
    setTimeout(() => setPositionNotice(null), 2500);
  };

  const handleExitApp = async () => {
    try {
      await invoke("exit_app");
    } catch (err) {
      console.warn("exit_app error", err);
    }
  };

  const isConnected = !!config.accessToken && !config.useMockData;

  return (
    <div className="modal-overlay">
      <div className="modal-header">
        <div className="modal-title">Налаштування віджета</div>
        <button className="action-icon-btn" onClick={onClose} title="Закрити">
          <X size={15} />
        </button>
      </div>

      <div className="modal-body">
        {/* Google Tasks Connection Section */}
        <div
          style={{
            background: isConnected
              ? "rgba(52, 168, 83, 0.12)"
              : "rgba(66, 133, 244, 0.12)",
            border: `1px solid ${
              isConnected
                ? "rgba(52, 168, 83, 0.35)"
                : "rgba(66, 133, 244, 0.35)"
            }`,
            padding: "10px",
            borderRadius: "10px",
            display: "flex",
            flexDirection: "column",
            gap: 7,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                color: isConnected ? "#4ade80" : "#8ab4f8",
                fontSize: "12px",
              }}
            >
              Синхронізація з Google Tasks
            </span>
            {isConnected ? (
              <span
                style={{
                  color: "#4ade80",
                  fontSize: "10.5px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                ● Підключено
              </span>
            ) : (
              <span
                style={{
                  color: "rgba(255,255,255,0.45)",
                  fontSize: "10px",
                }}
              >
                Не підключено
              </span>
            )}
          </div>

          {isConnected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p
                style={{
                  fontSize: "10.5px",
                  color: "rgba(255,255,255,0.7)",
                  lineHeight: "1.35",
                }}
              >
                Віджет успішно синхронізується з вашим акаунтом Google Tasks.
              </p>
              <button
                onClick={handleLogout}
                style={{
                  background: "rgba(255, 69, 58, 0.18)",
                  color: "#ff6961",
                  border: "1px solid rgba(255, 69, 58, 0.3)",
                  borderRadius: "7px",
                  padding: "5px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <LogOut size={12} /> Відключити акаунт (Вийти)
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <p
                style={{
                  fontSize: "10.5px",
                  color: "rgba(255,255,255,0.65)",
                  lineHeight: "1.35",
                }}
              >
                Авторизація в 1 клік відкриває браузер та зберігає токени доступу.
              </p>

              {isLoggingIn ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    background: "rgba(0,0,0,0.25)",
                    padding: "8px",
                    borderRadius: "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "11px",
                      color: "#8ab4f8",
                      fontWeight: 500,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={12} className="spin" /> Очікуємо вхід у браузері...
                    </span>
                    <button
                      onClick={handleCancelLogin}
                      style={{
                        background: "rgba(255,255,255,0.1)",
                        border: "none",
                        color: "#fff",
                        borderRadius: "5px",
                        padding: "2px 6px",
                        fontSize: "10px",
                        cursor: "pointer",
                      }}
                    >
                      Скасувати
                    </button>
                  </div>

                  <div
                    style={{
                      fontSize: "9.5px",
                      color: "rgba(255,255,255,0.5)",
                      lineHeight: "1.3",
                    }}
                  >
                    Якщо вікно браузера не відкрилося самостійно:
                  </div>

                  <div style={{ display: "flex", gap: 5 }}>
                    <button
                      onClick={() => currentAuthUrl && handleOpenExternal(currentAuthUrl)}
                      style={{
                        flex: 1,
                        background: "rgba(66, 133, 244, 0.2)",
                        border: "1px solid rgba(66, 133, 244, 0.4)",
                        color: "#8ab4f8",
                        borderRadius: "5px",
                        padding: "4px",
                        fontSize: "10px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 3,
                      }}
                    >
                      <ExternalLink size={10} /> Відкрити знову
                    </button>
                    <button
                      onClick={handleCopyUrl}
                      style={{
                        flex: 1,
                        background: "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        color: "#fff",
                        borderRadius: "5px",
                        padding: "4px",
                        fontSize: "10px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 3,
                      }}
                    >
                      {copiedUrl ? <Check size={10} color="#4ade80" /> : <Copy size={10} />}
                      {copiedUrl ? "Скопійовано!" : "Скопіювати лінк"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleOneClickLogin}
                  style={{
                    background: "#1a73e8",
                    color: "#fff",
                    border: "none",
                    borderRadius: "7px",
                    padding: "7px 10px",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <LogIn size={13} /> Увійти через Google
                </button>
              )}

              {authError && (
                <div
                  style={{
                    color: "#ff453a",
                    fontSize: "10px",
                    background: "rgba(255, 69, 58, 0.1)",
                    padding: "5px 7px",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <AlertCircle size={12} style={{ flexShrink: 0 }} />
                  <span>{authError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Position and Locking Group */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            padding: "9px 10px",
            borderRadius: "10px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div className="setting-row">
            <div>
              <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                <Lock size={12} /> Зафіксувати положення та розмір
              </div>
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.5)" }}>
                Забороняє переміщення та зміну розміру вікна за краї
              </div>
            </div>
            <input
              type="checkbox"
              checked={config.isPositionLocked}
              onChange={(e) => handleToggleLockPosition(e.target.checked)}
              style={{ width: 16, height: 16, cursor: "pointer" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.65)" }}>
                Користувацьке положення:
              </span>
              {currentCoords && (
                <span style={{ fontSize: "10.5px", color: "#8ab4f8", fontFamily: "monospace", fontWeight: 600 }}>
                  X: {currentCoords.x}, Y: {currentCoords.y}
                </span>
              )}
            </div>

            {positionNotice && (
              <div style={{ fontSize: "10.5px", color: "#4ade80", fontWeight: 600 }}>
                ✓ {positionNotice}
              </div>
            )}

            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={handleLockCurrentPosition}
                style={{
                  flex: 1.3,
                  background: config.isPositionLocked ? "rgba(52, 168, 83, 0.22)" : "rgba(66, 133, 244, 0.25)",
                  border: config.isPositionLocked ? "1px solid rgba(52, 168, 83, 0.55)" : "1px solid rgba(66, 133, 244, 0.5)",
                  color: config.isPositionLocked ? "#4ade80" : "#8ab4f8",
                  borderRadius: "6px",
                  padding: "7px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <Lock size={12} /> {config.isPositionLocked ? "Зафіксовано тут" : "Зафіксувати тут"}
              </button>

              <button
                type="button"
                onClick={handleUnlockPosition}
                style={{
                  flex: 1,
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#fff",
                  borderRadius: "6px",
                  padding: "7px 10px",
                  fontSize: "11px",
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <Unlock size={12} /> Розблокувати
              </button>
            </div>

            <div style={{ fontSize: "9.5px", color: "rgba(255,255,255,0.45)", lineHeight: "1.35", marginTop: 2 }}>
              Поставте віджет мишкою у будь-яке потрібне місце (хоч впритул до краю екрана) і натисніть «Зафіксувати тут» або кнопку у шапці.
            </div>
          </div>
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
            style={{
              background: "transparent",
              border: "none",
              color: "#8ab4f8",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 3,
              fontSize: "10.5px",
            }}
          >
            <HelpCircle size={11} /> {showHelp ? "Сховати інструкцію" : "Інструкція"}
          </button>
        </div>

        {showHelp && (
          <div
            className="help-box"
            style={{
              fontSize: "10px",
              lineHeight: "1.45",
              color: "rgba(255,255,255,0.75)",
              background: "rgba(0,0,0,0.3)",
              padding: "9px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            1. Відкрийте{" "}
            <a
              href="#console"
              onClick={(e) => {
                e.preventDefault();
                handleOpenExternal("https://console.cloud.google.com/apis/credentials");
              }}
              style={{
                color: "#8ab4f8",
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              Google Cloud Console Credentials ↗
            </a>
            .<br />
            2. Переконайтесь, що в <b>Enabled APIs</b> увімкнено <b>Google Tasks API</b>.<br />
            3. Створіть <b>OAuth Client ID</b> (Тип додатку: <b>Desktop application</b>).<br />
            4. Вставте отримані Client ID та Client Secret нижче та натисніть кнопку «Увійти через Google».
          </div>
        )}

        <div className="setting-group">
          <label className="setting-label">Google Client ID</label>
          <input
            className="setting-input"
            type="text"
            placeholder="123456789-xxx.apps.googleusercontent.com"
            value={config.clientId || ""}
            onChange={(e) => setConfig({ ...config, clientId: e.target.value })}
            style={{
              borderColor:
                authError && !(config.clientId || "").trim() ? "#ff453a" : undefined,
            }}
          />
        </div>

        <div className="setting-group">
          <label className="setting-label">Google Client Secret</label>
          <input
            className="setting-input"
            type="password"
            placeholder="GOCSPX-..."
            value={config.clientSecret || ""}
            onChange={(e) =>
              setConfig({ ...config, clientSecret: e.target.value })
            }
            style={{
              borderColor:
                authError && !(config.clientSecret || "").trim() ? "#ff453a" : undefined,
            }}
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
