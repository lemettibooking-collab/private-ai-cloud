type DetailDrawerProps = {
  title: string;
  children: React.ReactNode;
};

export function DetailDrawer({ title, children }: DetailDrawerProps) {
  return (
    <aside className="hidden w-80 shrink-0 border-l border-slate-800 bg-slate-950/80 p-5 xl:block">
      <p className="text-sm font-semibold text-slate-100">{title}</p>
      <div className="mt-4">{children}</div>
    </aside>
  );
}
