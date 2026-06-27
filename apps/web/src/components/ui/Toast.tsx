"use client";
import { useEffect, useState, useCallback } from "react";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

let _addToast: ((t: Omit<Toast, "id">) => void) | null = null;

export function toast(message: string, type: Toast["type"] = "info") {
  _addToast?.({ message, type });
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3200);
  }, []);

  useEffect(() => { _addToast = add; return () => { _addToast = null; }; }, [add]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span>{t.type === "success" ? "✓" : t.type === "error" ? "✗" : "ℹ"}</span>
          {t.message}
        </div>
      ))}
    </div>
  );
}
