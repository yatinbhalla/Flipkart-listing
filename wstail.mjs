// Tail the Flipkart Lister WebSocket to stdout so a headless run can be watched.
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3002/ws');
ws.on('open', () => console.log('[tail] connected'));
ws.on('message', (buf) => {
  const m = JSON.parse(buf.toString());
  const t = new Date().toLocaleTimeString([], { hour12: false });
  if (m.type === 'event') {
    if (m.event === 'tabs') {
      const s = Object.entries(m.states)
        .map(([k, v]) => `${k.split(' ')[0]} ${v.filled}/${v.total}${v.errors ? ` ERR:${v.errors}` : ' ok'}`)
        .join(' | ');
      console.log(`${t} [tabs] ${s}`);
    } else {
      console.log(`${t} [${m.event}] ${JSON.stringify({ ...m, type: undefined, event: undefined })}`);
    }
    return;
  }
  console.log(`${t} ${m.type === 'error' ? 'ERROR' : m.type === 'success' ? 'OK' : '·'} ${m.text}`);
});
ws.on('close', () => { console.log('[tail] closed'); process.exit(0); });
ws.on('error', (e) => console.log('[tail] error', e.message));
