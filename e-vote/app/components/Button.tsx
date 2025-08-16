import { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button(
  { className = "", variant = "primary", disabled, ...rest }: ComponentProps<'button'> & { variant?: Variant }
) {
  const base = "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black/20 disabled:cursor-not-allowed disabled:opacity-60";
  const variants: Record<Variant, string> = {
    primary: "bg-black text-white hover:bg-gray-800",
    secondary: "bg-white text-gray-900 border border-gray-200 hover:bg-gray-50",
    ghost: "bg-transparent text-gray-700 hover:bg-gray-100",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} disabled={disabled} {...rest} />;
}