import { useEffect, useRef, useState } from 'react';

/**
 * Live log feed from the server. Reconnects on drop so a server restart during a
 * long Playwright run doesn't leave the UI silently dead.
 */
export function useWebSocket() {
  const [lines, setLines] = useState([]);
  const [events, setEvents] = useState({});
  const ref = useRef(null);

  useEffect(() => {
    let closed = false;

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      ref.current = ws;

      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.type === 'event') {
          setEvents((prev) => ({ ...prev, [data.event]: data }));
          return;
        }
        setLines((prev) => [...prev.slice(-400), { ...data, at: new Date() }]);
      };

      ws.onclose = () => {
        if (!closed) setTimeout(connect, 1500);
      };
    }

    connect();
    return () => {
      closed = true;
      ref.current?.close();
    };
  }, []);

  return { lines, events, clear: () => setLines([]) };
}
