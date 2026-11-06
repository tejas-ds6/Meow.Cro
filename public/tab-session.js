const storageKey = "meowcro_tab_session";
let userActivityPending = false;
let sessionExpiryTimer;
let sessionExpiryAt = 0;
let sessionExpiryHandler;

function createTabId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function initializeTabId() {
  let tabId;
  try {
    tabId = sessionStorage.getItem(storageKey);
    if (!/^[\da-f]{32}$/i.test(tabId || "")) {
      tabId = createTabId();
      sessionStorage.setItem(storageKey, tabId);
    }
  } catch {
    return "";
  }

  if ("BroadcastChannel" in window) {
    let channel;
    try {
      channel = new BroadcastChannel("meowcro-tab-session");
    } catch {
      return tabId;
    }
    const probeId = createTabId();
    const duplicate = await new Promise((resolve) => {
      let activeTabFound = false;
      channel.addEventListener("message", (event) => {
        if (event.data?.type === "probe" && event.data.tabId === tabId) {
          channel.postMessage({ type: "active", tabId, probeId: event.data.probeId });
        } else if (event.data?.type === "active" && event.data.tabId === tabId && event.data.probeId === probeId) {
          activeTabFound = true;
        }
      });
      channel.postMessage({ type: "probe", tabId, probeId });
      window.setTimeout(() => resolve(activeTabFound), 120);
    });

    if (duplicate) {
      tabId = createTabId();
      try {
        sessionStorage.setItem(storageKey, tabId);
      } catch {
        channel.close();
        return "";
      }
    }
    window.addEventListener("pagehide", () => channel.close(), { once: true });
  }

  return tabId;
}

export const tabSessionId = await initializeTabId();
export const tabSessionError = tabSessionId
  ? ""
  : "This browser cannot keep a secure tab session. Enable session storage and reload.";

for (const eventName of ["pointerdown", "keydown", "touchstart"]) {
  document.addEventListener(eventName, () => {
    userActivityPending = true;
  }, { capture: true, passive: true });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") userActivityPending = true;
  if (document.visibilityState === "visible" && sessionExpiryAt && Date.now() >= sessionExpiryAt) {
    sessionExpiryHandler?.();
  }
});

window.addEventListener("pageshow", () => {
  if (sessionExpiryAt && Date.now() >= sessionExpiryAt) sessionExpiryHandler?.();
});

export function tabSessionHeaders(headers = {}) {
  if (!tabSessionId) throw new Error(tabSessionError);
  const result = { ...headers, "X-Tab-Session": tabSessionId };
  if (userActivityPending) {
    result["X-User-Activity"] = "1";
    userActivityPending = false;
  }
  return result;
}

export function observeSessionExpiry(response, onExpired) {
  const idleExpiry = Date.parse(response.headers.get("X-Session-Idle-Expires-At") || "");
  const absoluteExpiry = Date.parse(response.headers.get("X-Session-Expires-At") || "");
  if (!Number.isFinite(idleExpiry) || !Number.isFinite(absoluteExpiry)) return;
  const expiryAt = Math.min(idleExpiry, absoluteExpiry);
  if (expiryAt < sessionExpiryAt) return;
  sessionExpiryAt = expiryAt;
  sessionExpiryHandler = onExpired;
  window.clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer = window.setTimeout(() => {
    sessionExpiryHandler?.();
  }, Math.max(0, expiryAt - Date.now()));
}

export function clearSessionExpiry() {
  window.clearTimeout(sessionExpiryTimer);
  sessionExpiryAt = 0;
  sessionExpiryHandler = undefined;
}
