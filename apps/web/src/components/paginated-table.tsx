'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useT } from '@/i18n';
import { api } from '@/lib/api';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Paginated list backed by a `{ items, page, pageSize, total }` endpoint —
 * the shape every admin list route returns.
 */
export function PaginatedTable<T>({
  queryKey,
  path,
  columns,
  rowKey,
  page,
  onPageChange,
}: {
  queryKey: readonly unknown[];
  /** Path with any filters already applied; `page`/`pageSize` are appended. */
  path: string;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const t = useT();
  const separator = path.includes('?') ? '&' : '?';

  const query = useQuery({
    queryKey: [...queryKey, page],
    queryFn: () => api.get<Page<T>>(`${path}${separator}page=${page}&pageSize=25`),
  });

  if (query.isPending) {
    return (
      <Card>
        <p className="p-4 text-sm text-muted-foreground">{t('common.loading')}</p>
      </Card>
    );
  }
  if (query.isError) {
    return (
      <Card>
        <p className="p-4 text-sm text-destructive">{t('common.error')}</p>
      </Card>
    );
  }

  const pages = Math.max(1, Math.ceil(query.data.total / query.data.pageSize));

  return (
    <Card>
      {query.data.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t('common.empty')}</p>
      ) : (
        <Table>
          <THead>
            <TR>
              {columns.map((column) => (
                <TH key={column.header}>{column.header}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {query.data.items.map((row) => (
              <TR key={rowKey(row)}>
                {columns.map((column) => (
                  <TD key={column.header} className={column.className}>
                    {column.cell(row)}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <div className="flex items-center justify-between border-t border-border p-3 text-xs">
        <span className="text-muted-foreground">{t('common.page', { page, pages })}</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => {
              onPageChange(page - 1);
            }}
          >
            {t('common.previous')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pages}
            onClick={() => {
              onPageChange(page + 1);
            }}
          >
            {t('common.next')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
