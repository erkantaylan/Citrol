import type { ServerEvent } from "./types.ts";

type Handlers = {
  onEvent: (event: ServerEvent) => void;
  // Fires on every successful (re)connect; `again` is false only the first time.
  onOpen: (again: boolean) => void;
  onClose: () => void;
};

const MIN_DELAY = 1000;
const MAX_DELAY = 15000;

export type Socket = { send: (data: object) => void; close: () => void };

export function connect(handlers: Handlers): Socket {
  let ws: WebSocket | null = null;
  let delay = MIN_DELAY;
  let opened = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      delay = MIN_DELAY;
      handlers.onOpen(opened);
      opened = true;
    };

    ws.onmessage = (e) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (event && typeof event.type === "string") handlers.onEvent(event);
    };

    ws.onclose = () => {
      ws = null;
      if (stopped) return;
      handlers.onClose();
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, MAX_DELAY);
    };
  }

  open();

  return {
    send(data) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
