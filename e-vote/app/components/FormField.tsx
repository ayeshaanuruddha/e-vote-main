import { PropsWithChildren } from "react";

export function FormField({ label, hint, children }: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <label className="block text-sm">
      <span className="text-gray-800 font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </label>
  );
}