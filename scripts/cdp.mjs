// HTTP discovery and WebSocket connections use the same reachable endpoint,
// including when Chrome is behind an SSH tunnel or a port forward.
export function normalizeEndpoint(value = 'http://localhost:9222') {
  const url = new URL(value.includes('://') ? value : `http://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CDP 地址必须是 http(s)://主机:端口，不包含路径或凭据');
  }
  return url.origin;
}

export function debuggerUrl(value, endpoint) {
  const advertised = new URL(value);
  if (!['ws:', 'wss:'].includes(advertised.protocol)) throw new Error('无效的 CDP WebSocket 地址');
  const reachable = new URL(endpoint);
  advertised.protocol = reachable.protocol === 'https:' ? 'wss:' : 'ws:';
  advertised.hostname = reachable.hostname;
  advertised.port = reachable.port;
  return advertised.href;
}

export async function discover(endpoint, path, options = {}) {
  const response = await fetch(`${endpoint}${path}`, {
    ...options,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`CDP ${path}: HTTP ${response.status}`);
  return response.json();
}

export async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('CDP WebSocket 连接超时'));
      ws.close();
    }, 10000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`无法连接 CDP WebSocket: ${url}`)); };
  });
  let seq = 0;
  const pending = new Map();
  const failAll = error => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear();
  };
  ws.onclose = () => failAll(new Error('CDP 连接已关闭'));
  ws.onerror = () => failAll(new Error('CDP 连接错误'));
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    clearTimeout(p.timer);
    message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
  };
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP 命令超时: ${method}`));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        try { ws.send(JSON.stringify({ id, method, params })); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    },
    close() { ws.close(); },
  };
}
