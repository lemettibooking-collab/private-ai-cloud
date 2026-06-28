import Link from "next/link";

type ActionButtonProps = {
  children: React.ReactNode;
  href?: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
};

const variants = {
  primary:
    "border-cyan-400/40 bg-cyan-400/15 text-cyan-100 hover:bg-cyan-400/25",
  secondary:
    "border-slate-600/80 bg-slate-900/80 text-slate-200 hover:bg-slate-800",
  danger:
    "border-rose-400/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20",
};

export function ActionButton({
  children,
  href,
  variant = "primary",
  disabled = false,
}: ActionButtonProps) {
  const className = `inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition ${variants[variant]} ${
    disabled ? "cursor-not-allowed opacity-50 hover:bg-inherit" : ""
  }`;

  if (href && !disabled) {
    return (
      <Link className={className} href={href}>
        {children}
      </Link>
    );
  }

  return (
    <button className={className} disabled={disabled} type="button">
      {children}
    </button>
  );
}
