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
    <div className="overflow-x-auto rounded-pac border border-line">
      <table className="min-w-full divide-y divide-line text-left text-[13px]">
        <thead className="bg-panel-2">
          <tr>
            {columns.map((column) => (
              <th className="pac-label px-3 py-2 font-medium" key={String(column.key)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-panel">
          {rows.map((row) => (
            <tr className="hover:bg-panel-2" key={getRowKey(row)}>
              {columns.map((column) => (
                <td className="px-3 py-2 text-ink-2" key={String(column.key)}>
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
