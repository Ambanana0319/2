export function createApiRequestId() {
  if (globalThis.crypto?.randomUUID) return `web-${globalThis.crypto.randomUUID()}`;
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function api(path, options = {}) {
  const {
    timeoutMs = 0,
    requestId = createApiRequestId(),
    signal: externalSignal,
    ...fetchOptions
  } = options;
  const init = { ...fetchOptions, headers: { ...(fetchOptions.headers || {}) } };
  init.headers["X-Gugu-Request-ID"] = requestId;
  if (
    init.body
    && typeof init.body !== "string"
    && !(init.body instanceof ArrayBuffer)
    && !(init.body instanceof Blob)
  ) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.body);
  }
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) abortFromCaller();
    else externalSignal.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timer = Number(timeoutMs) > 0 ? setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Number(timeoutMs)) : null;
  init.signal = controller.signal;
  let response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    const error = new Error(
      timedOut
        ? `请求等待超过 ${Math.ceil(Number(timeoutMs) / 1000)} 秒；后端可能仍在收尾，可查看真实活动状态后安全重试`
        : controller.signal.aborted
          ? "请求已取消；后端若已收到请求会继续记录最终状态"
          : "无法连接本地 Gugu 服务，请确认服务仍在运行"
    );
    error.kind = timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "network";
    error.requestId = requestId;
    error.cause = cause;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", abortFromCaller);
  }
  const contentType = response.headers.get("content-type") || "";
  let data;
  try {
    data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
  } catch (cause) {
    const error = new Error("本地服务返回了无法读取的响应");
    error.kind = "invalid_response";
    error.status = response.status;
    error.requestId = requestId;
    error.cause = cause;
    throw error;
  }
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || `请求失败 (${response.status})`);
    error.kind = response.status >= 500 ? "server" : "http";
    error.status = response.status;
    error.payload = data;
    error.requestId = requestId;
    throw error;
  }
  return data;
}

export function projectApiActivity(projectId, options = {}) {
  return api(`/api/projects/${encodeURIComponent(projectId)}/api-activity`, {
    ...options,
    timeoutMs: options.timeoutMs ?? 5000,
  });
}
