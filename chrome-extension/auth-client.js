import { createClient } from "./supabase.js";
import { createAuthService } from "./auth-core.js";

const AUTH_STORAGE_KEY = "focuslock-guardian-auth";

const supabaseSessionStorage = {
  async getItem(key) {
    const values = await chrome.storage.session.get(key);
    return typeof values[key] === "string" ? values[key] : null;
  },
  async setItem(key, value) {
    await chrome.storage.session.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.session.remove(key);
  },
};

export function createExtensionAuth() {
  return createAuthService({
    createClient,
    storage: chrome.storage.local,
    sessionStorage: supabaseSessionStorage,
    authStorageKey: AUTH_STORAGE_KEY,
  });
}
