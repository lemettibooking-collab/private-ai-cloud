type DataTableProps<T> = {
  columns: Array<{
    key: keyof T | string;
    header: string;
    render?: (row: T) => React.ReactNode;
  }>;
  rows: T[];
  getRowKey: (row: T) => string;
};

export function DataTable<T>({ columns, rows, getRowKey }: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-800">
      <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
        <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((column) => (
              <th className="px-4 py-3 font-medium" key={String(column.key)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 bg-slate-950/40">
          {rows.map((row) => (
            <tr className="hover:bg-slate-900/50" key={getRowKey(row)}>
              {columns.map((column) => (
                <td className="px-4 py-3 text-slate-300" key={String(column.key)}>
                  {column.render
                    ? column.render(row)
                    : String(row[column.key as keyof T] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
