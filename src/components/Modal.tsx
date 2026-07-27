"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-purple-900/40 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-auto w-full rounded-2xl bg-cream shadow-2xl ${
          wide ? "max-w-4xl" : "max-w-2xl"
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-cream-dark px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-purple-700">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-sm text-purple-900/55">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-purple-900/50 transition hover:bg-cream-dark hover:text-purple-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
