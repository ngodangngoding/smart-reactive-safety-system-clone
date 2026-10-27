import axios from "axios";
import api, { API_URL } from "@/services/apiService.js";
import { REFRESH_TOKEN_KEY, writeTokens, writeContext, patchStoredUser, clearSession } from "@/lib/session.js";

async function startSession(path, body, fallbackMessage) {
  try {
    const response = await api.post(path, body);

    if (response.data?.status === "success") {
      const { user, organization, permissions } = response.data.data;
      writeTokens(response.data.data);
      writeContext({ user, organization, permissions });
      return user;
    }

    throw new Error(response.data?.message || fallbackMessage);
  } catch (error) {
    console.error("Error logging in:", error);
    throw error;
  }
}

export const login = (email, password) => startSession("/auth/login", { email, password }, "Failed to log in");

export const loginWithGoogle = (idToken) => startSession("/auth/google", { idToken }, "Google sign-in failed");

export const getCurrentUser = async () => {
  try {
    const response = await api.get("/auth/me");

    if (response.data?.status === "success") {
      return response.data.data;
    }

    throw new Error(response.data?.message || "Failed to load current user");
  } catch (error) {
    console.error("Error loading current user:", error);
    throw error;
  }
};

export const logout = () => {
  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
  if (refreshToken) {
    axios.post(`${API_URL}/auth/logout`, { refreshToken }).catch(() => { });
  }
  clearSession();
};

export const forgotPassword = async (email) => {
  const response = await api.post("/auth/forgot-password", { email });
  return { ...response.data.data, message: response.data.message };
};

export const verifyOtp = async (email, otpCode) => {
  const response = await api.post("/auth/verify-otp", { email, otpCode });
  return response.data.data;
};

export const resetPassword = async ({ resetToken, newPassword, confirmPassword }) => {
  const response = await api.post("/auth/reset-password", { resetToken, newPassword, confirmPassword });
  return response.data.data;
};

export const changePassword = async ({ currentPassword, newPassword }) => {
  const response = await api.patch("/auth/change-password", { currentPassword, newPassword });
  writeTokens(response.data.data);
  patchStoredUser({ hasPassword: true });
  return { message: response.data.message };
};

export const isAuthenticated = () => {
  return typeof window !== "undefined" && Boolean(window.localStorage.getItem("access_token"));
};

export const updateProfile = async ({ name, email }) => {
  const response = await api.patch("/auth/me", { name, email });
  const { user } = response.data.data;
  patchStoredUser(user);
  return { data: user, message: response.data.message };
};

export const uploadAvatar = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post("/auth/me/avatar", formData);
  const { user } = response.data.data;
  patchStoredUser(user);
  return { data: user, message: response.data.message };
};

export const removeAvatar = async () => {
  const response = await api.delete("/auth/me/avatar");
  const { user } = response.data.data;
  patchStoredUser(user);
  return { data: user, message: response.data.message };
};

export const deleteAccount = async (password) => {
  const response = await api.delete("/auth/me", { data: { password } });
  clearSession();
  return { message: response.data.message };
};
