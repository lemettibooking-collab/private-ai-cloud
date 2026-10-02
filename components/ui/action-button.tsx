import Link from "next/link";

type ActionButtonProps = {
  children: React.ReactNode;
  href?: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
};

const variants = {
  primary: "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20",
  secondary: "border-line-strong bg-panel-2 text-ink-2 hover:bg-raised",
  danger: "border-bad/40 bg-bad/10 text-bad hover:bg-bad/20",
};

export function ActionButton({
  children,
  href,
  variant = "primary",
  disabled = false,
}: ActionButtonProps) {
  const className = `inline-flex h-8 items-center justify-center rounded-pac border px-3 text-[13px] font-medium transition ${variants[variant]} ${
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
