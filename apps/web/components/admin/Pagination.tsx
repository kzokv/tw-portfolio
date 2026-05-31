"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/Button";
import { useAdminI18n } from "./admin-i18n";

interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, limit, total, onPageChange }: PaginationProps) {
  const dict = useAdminI18n();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between" data-testid="pagination">
      <p className="text-sm text-slate-500">
        {total === 0
          ? dict.pagination.noResults
          : dict.pagination.summary
            .replace("{start}", String(from))
            .replace("{end}", String(to))
            .replace("{total}", String(total))}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={dict.common.previousPage}
          data-testid="pagination-prev"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-3 text-sm text-slate-700">
          {page} / {totalPages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label={dict.common.nextPage}
          data-testid="pagination-next"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
