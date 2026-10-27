// In-memory stand-in for Redis: zero external infrastructure for the demo build.
// Same exported shape as the real client (get/setEx/setNxEx/del/ttl/getDel/evalScript/
// multiSetEx) so every call site in this app is unchanged.
const store = globalThis.__memoryRedis ?? new Map();
globalThis.__memoryRedis = store;

function live(entry) {
  return Boolean(entry) && entry.expiresAt > Date.now();
}

function get(key) {
  const entry = store.get(key);
  if (!live(entry)) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function setEx(key, seconds, value) {
  store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
}

// ponytail: this app only ever evals one Lua script (OTP verify with attempt lockout,
// see src/app/api/auth/verify-otp/route.js). Porting that script's logic directly is far
// simpler than writing a general Lua interpreter for a single call site; if a second
// script shows up, branch on script content the same way.
function evalOtpVerify(key, otpCode, maxAttempts) {
  const raw = get(key);
  if (!raw) return ["NOT_FOUND"];

  const data = JSON.parse(raw);
  if (data.attemptCount >= maxAttempts) {
    store.delete(key);
    return ["LOCKED"];
  }
  if (String(data.otpCode) === otpCode) {
    store.delete(key);
    return ["OK", String(data.userId)];
  }

  data.attemptCount += 1;
  const remaining = maxAttempts - data.attemptCount;
  if (remaining <= 0) {
    store.delete(key);
    return ["LOCKED"];
  }
  const entry = store.get(key);
  if (!live(entry)) {
    store.delete(key);
    return ["NOT_FOUND"];
  }
  entry.value = JSON.stringify(data); // keeps the same expiresAt, like the Lua script's `SET ... EX ttl`
  return ["INVALID", String(remaining)];
}

export const redis = {
  get: async (key) => get(key),
  setEx: async (key, seconds, value) => {
    setEx(key, seconds, value);
  },
  setNxEx: async (key, seconds, value) => {
    if (get(key) !== null) return false;
    setEx(key, seconds, value);
    return true;
  },
  del: async (...keys) => {
    for (const key of keys) store.delete(key);
  },
  ttl: async (key) => {
    const entry = store.get(key);
    if (!live(entry)) return -2;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  },
  getDel: async (key) => {
    const value = get(key);
    store.delete(key);
    return value;
  },
  evalScript: async (script, keys, args) => {
    if (!script.includes("attemptCount")) throw new Error("evalScript: unrecognized script (no in-memory port available)");
    return evalOtpVerify(keys[0], args[0], Number(args[1]));
  },
  multiSetEx: async (entries) => {
    for (const [key, seconds, value] of entries) setEx(key, seconds, value);
  },
};
