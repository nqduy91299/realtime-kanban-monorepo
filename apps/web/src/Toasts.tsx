import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { BoardClient, Rejection } from "@kanban/client";
import { describeFailure } from "./messages.js";

interface Toast {
  id: number;
  text: string;
}

const ToastContext = createContext<(text: string) => void>(() => {});

export const useToast = () => useContext(ToastContext);

/**
 * Toasts double as the screen-reader announcement (role="status" is a polite live region, O4).
 * Server rejections that arrive together are collapsed into one toast (O5).
 */
export function ToastProvider({ client, children }: { client: BoardClient | null; children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const show = useCallback((text: string) => {
    const id = ++nextId.current;
    setToasts((current) => [...current.slice(-2), { id, text }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);

  useEffect(() => {
    if (!client) return;
    let batch: Rejection[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      const all = batch;
      batch = [];
      if (all.length === 0) return;
      // F6: after an offline flush several can fail at once. Name each one (up to three).
      const lines = all.slice(0, 3).map((r) => describeFailure(client, r.intent, r.code));
      const more = all.length > 3 ? ` And ${all.length - 3} more.` : "";
      show(all.length === 1 ? lines[0]! : `${all.length} changes couldn't be saved. ${lines.join(" ")}${more}`);
    };
    const stop = client.onRejected((rejection) => {
      batch.push(rejection);
      clearTimeout(timer);
      timer = setTimeout(flush, 300);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [client, show]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
