import config from "@/data/app-config.json";

export interface AppConfig {
  id: string;
  familyName: string;
  appName: string;
  basePath: string;
  iconLabel: string;
  accent: string;
}

export const APP_CONFIG = config as AppConfig;
export const databaseNameFor = (appId: string) => `atlas-${appId}-v1`;
// Reset only stale view state when canvas framing changes; family data is untouched.
export const viewportKeyFor = (appId: string) => `atlas-${appId}-viewport-v3`;
export const cachePrefixFor = (appId: string) => `atlas-cache-${appId}-`;
