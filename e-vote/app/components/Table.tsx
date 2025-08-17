import { PropsWithChildren } from "react";
export function Table({ children }: PropsWithChildren) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-100 text-sm">{children}</table>
    </div>
  );
}