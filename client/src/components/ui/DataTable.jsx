import { PaginatedTableBody } from "./TablePagination.jsx";

export function DataTable({ columns, rows }) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <PaginatedTableBody colSpan={columns.length} items={rows}>{(row) => <tr key={row.id}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}</tr>}</PaginatedTableBody>
      </table>
    </div>
  );
}
