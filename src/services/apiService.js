import axios from "axios";
import toast from "react-hot-toast";

import { GENERIC_ERROR, apiErrorMessage } from "@/lib/apiError.js";
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, writeTokens, clearSession } from "@/lib/session.js";

export { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, clearSession };

// Falls back to a same-origin relative path when NEXT_PUBLIC_API_URL isn't set, so the
// demo build works with zero env vars (the frontend and API are served from one Next.js app).
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem(ACCESS_TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const LICENSE_BLOCK_KEY = "license_block";
const LICENSE_CODES = ["LICENSE_EXPIRED", "LICENSE_NOT_STARTED"];

export const isLicenseBlockError = (error) => error?.response?.status === 403 && LICENSE_CODES.includes(error.response.data?.data?.code);

function isOrganizationSession() {
  try {
    return Boolean(window.localStorage.getItem(ACCESS_TOKEN_KEY)) && JSON.parse(window.localStorage.getItem("user"))?.role === "ADMIN";
  } catch {
    return false;
  }
}

let licenseBlocked = false;

function blockForLicense(error) {
  if (licenseBlocked) return;
  licenseBlocked = true;
  const { message, data } = error.response.data;
  window.sessionStorage.setItem(LICENSE_BLOCK_KEY, JSON.stringify({ code: data.code, message }));
  clearSession();
  window.location.replace("/license-expired");
}

function clearSessionAndRedirect() {
  clearSession();
  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

export function unwrap(response, fallback = GENERIC_ERROR) {
  if (response.data?.status === "success") return response.data.data;
  throw new Error(response.data?.message || fallback);
}

export function unwrapMutation(response, fallback = GENERIC_ERROR) {
  return { data: unwrap(response, fallback), message: response.data.message };
}

let refreshPromise = null;

function refreshAccessToken() {
  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return Promise.reject(new Error("No refresh token"));

  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_URL}/auth/refresh`, { refreshToken })
      .then((response) => {
        const tokens = response.data.data;
        writeTokens(tokens);
        return tokens.accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (typeof window === "undefined") return Promise.reject(error);

    const status = error.response?.status;
    const code = error.response?.data?.data?.code;

    if (isLicenseBlockError(error) && isOrganizationSession()) {
      blockForLicense(error);
      return Promise.reject(error);
    }

    if (status === 401 && code === "TOKEN_REVOKED") {
      clearSessionAndRedirect();
      return Promise.reject(error);
    }

    if (status === 403 && code === "ACTING_ORG_UNAVAILABLE") {
      const { exitOrganization } = await import("@/services/organizationService.js");
      exitOrganization();
      toast.error(apiErrorMessage(error));
      return Promise.reject(error);
    }

    if (status !== 401 || original?._retried) return Promise.reject(error);

    original._retried = true;
    try {
      const accessToken = await refreshAccessToken();
      original.headers.Authorization = `Bearer ${accessToken}`;
      return api(original);
    } catch (refreshError) {
      if (isLicenseBlockError(refreshError)) blockForLicense(refreshError);
      else clearSessionAndRedirect();
      return Promise.reject(error);
    }
  }
);

export default api;
