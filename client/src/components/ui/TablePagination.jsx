import { useEffect, useMemo, useState } from "react";

const DEFAULT_PAGE_SIZE = 10;

const rowIdentity = (item, index) => Array.isArray(item) ? item.find((value) => typeof value === "string" || typeof value === "number") ?? index : item?.id ?? item?.staffId ?? item?.rank ?? item?.name ?? item?.code ?? index;

export function TablePagination({ onPageChange, page, pageSize = DEFAULT_PAGE_SIZE, totalItems }) {
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <nav aria-label="Table pagination" className="table-pagination">
      <span>Showing {start}–{end} of {totalItems}</span>
      <div className="table-pagination__controls">
        <button disabled={page === 1} onClick={() => onPageChange(page - 1)} type="button">Previous</button>
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
          <button aria-current={pageNumber === page ? "page" : undefined} className={pageNumber === page ? "is-active" : ""} key={pageNumber} onClick={() => onPageChange(pageNumber)} type="button">{pageNumber}</button>
        ))}
        <button disabled={page === totalPages} onClick={() => onPageChange(page + 1)} type="button">Next</button>
      </div>
    </nav>
  );
}

export function PaginatedTableBody({ children, colSpan, items, pageSize = DEFAULT_PAGE_SIZE }) {
  const signature = useMemo(() => items.map(rowIdentity).join("|"), [items]);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => { setPage(1); }, [items, signature]);
  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);

  const startIndex = (page - 1) * pageSize;
  const visibleItems = items.slice(startIndex, startIndex + pageSize);

  return (
    <>
      <tbody>{visibleItems.map((item, index) => children(item, index, startIndex + index))}</tbody>
      {items.length > pageSize ? <tfoot><tr><td colSpan={colSpan}><TablePagination onPageChange={setPage} page={page} pageSize={pageSize} totalItems={items.length} /></td></tr></tfoot> : null}
    </>
  );
}
