export interface Task {
  id: string;
  title: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  due?: string; // ISO date string
  updated?: string;
  listId: string;
}

export interface TaskList {
  id: string;
  title: string;
  updated?: string;
}

export interface AppConfig {
  clientId: string;
  clientSecret: string;
  apiKey: string;
  accessToken: string;
  refreshToken: string;
  alwaysOnTop: boolean;
  autoRefreshMinutes: number;
  useMockData: boolean;
  isPositionLocked: boolean;
}
