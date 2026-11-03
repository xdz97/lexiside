import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [requestedId, port = '9224', output = 'artifacts/sidepanel-smoke.png'] = process.argv.slice(2);
if (requestedId && !/^[a-p]{32}$/.test(requestedId)) {
  console.error('用法：npm run smoke:extension -- [扩展 ID] [调试端口] [截图路径]');
  process.exit(1);
}

async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve: resolveCall, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolveCall(message.result);
    }
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolveCall, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, call };
}

let targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((value) => value.json());
if (!targets.some((value) => value.type === 'service_worker')) {
  const pageTarget = targets.find((value) => value.type === 'page' && value.url.startsWith('http'));
  if (pageTarget) {
    const pageSession = await connect(pageTarget.webSocketDebuggerUrl);
    await pageSession.call('Page.reload', { ignoreCache: true });
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    pageSession.socket.close();
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((value) => value.json());
  }
}
let extensionId = requestedId;
const discovered = [];
for (const candidate of targets.filter((value) => value.type === 'service_worker' && value.url.startsWith('chrome-extension://'))) {
  const session = await connect(candidate.webSocketDebuggerUrl);
  const manifestResult = await session.call('Runtime.evaluate', {
    expression: 'JSON.stringify(chrome.runtime.getManifest())',
    returnByValue: true,
  });
  session.socket.close();
  const manifest = JSON.parse(manifestResult.result.value);
  discovered.push({ id: new URL(candidate.url).hostname, name: manifest.name });
  if (manifest.name === '拾词 LexiSide') {
    extensionId = new URL(candidate.url).hostname;
    break;
  }
}
if (!discovered.some((item) => item.name === '拾词 LexiSide')) {
  throw new Error(`未找到已加载的拾词扩展：${JSON.stringify(discovered)}`);
}

const targetUrl = `chrome-extension://${extensionId}/sidepanel.html`;
const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
if (!response.ok) throw new Error(`无法创建调试页：HTTP ${response.status}`);
const target = await response.json();
const { socket, call } = await connect(target.webSocketDebuggerUrl);

await call('Page.enable');
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', {
  width: 400,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await call('Page.navigate', { url: targetUrl });
await new Promise((resolveWait) => setTimeout(resolveWait, 800));
const evaluation = await call('Runtime.evaluate', {
  expression: `JSON.stringify({ title: document.title, text: document.body.innerText, width: document.documentElement.scrollWidth, viewport: innerWidth })`,
  returnByValue: true,
});
const snapshot = JSON.parse(evaluation.result.value);
if (snapshot.title !== '拾词' || !snapshot.text.includes('从网页中拾取一个词')) {
  throw new Error(`侧边栏烟测失败：${JSON.stringify(snapshot)}`);
}
if (snapshot.width > snapshot.viewport) throw new Error(`侧边栏出现水平滚动：${JSON.stringify(snapshot)}`);
const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const outputPath = resolve(output);
await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
console.log(JSON.stringify({ ...snapshot, screenshot: outputPath }, null, 2));
socket.close();
