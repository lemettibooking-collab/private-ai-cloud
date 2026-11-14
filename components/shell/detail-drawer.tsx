type DetailDrawerProps = {
  title: string;
  children: React.ReactNode;
};

// Context drawer. AppShell renders it only when a page passes real context (no idle placeholder).
export function DetailDrawer({ title, children }: DetailDrawerProps) {
  return (
    <aside className="hidden w-80 shrink-0 border-l border-line bg-panel p-4 xl:block">
      <p className="pac-label !text-ink-2">{title}</p>
      <div className="mt-3">{children}</div>
    </aside>
  );
}
