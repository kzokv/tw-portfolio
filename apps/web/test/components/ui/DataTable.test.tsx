import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { DataTable, type DataTableColumn } from "../../../components/ui/DataTable";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

type Row = { id: string; ticker: string; price: number };

const baseColumns: DataTableColumn<Row>[] = [
  { key: "ticker", header: "Ticker", render: (r) => r.ticker },
  {
    key: "price",
    header: "Price",
    render: (r) => r.price.toFixed(2),
    priority: "md",
  },
];

const sampleData: Row[] = [
  { id: "a", ticker: "AAPL", price: 195.12 },
  { id: "b", ticker: "MSFT", price: 412.33 },
];

describe("DataTable", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders one <tr> per data row in the table body", () => {
    act(() => {
      root.render(
        <DataTable
          data={sampleData}
          columns={baseColumns}
          rowKey={(r) => r.id}
        />,
      );
    });
    const bodyRows = container.querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(2);
    expect(container.textContent).toContain("AAPL");
    expect(container.textContent).toContain("MSFT");
  });

  it("emits sticky-first-column class on first <th> and first <td> when stickyFirstColumn is set", () => {
    act(() => {
      root.render(
        <DataTable
          data={sampleData}
          columns={baseColumns}
          rowKey={(r) => r.id}
          stickyFirstColumn
        />,
      );
    });
    const firstTh = container.querySelector("thead th");
    const firstTd = container.querySelector("tbody td");
    expect(firstTh?.className).toContain("sticky");
    expect(firstTh?.className).toContain("left-0");
    expect(firstTd?.className).toContain("sticky");
    expect(firstTd?.className).toContain("left-0");
    // Second column should NOT be sticky.
    const secondTh = container.querySelectorAll("thead th")[1];
    expect(secondTh?.className ?? "").not.toContain("sticky");
  });

  it("invokes renderRow for each row instead of default cell rendering when provided", () => {
    const seen = new Set<string>();
    act(() => {
      root.render(
        <DataTable
          data={sampleData}
          columns={baseColumns}
          rowKey={(r) => r.id}
          renderRow={(row) => {
            seen.add(row.id);
            return (
              <tr data-testid={`custom-${row.id}`}>
                <td colSpan={2}>{`CUSTOM:${row.ticker}`}</td>
              </tr>
            );
          }}
        />,
      );
    });
    expect([...seen].sort()).toEqual(["a", "b"]);
    expect(container.querySelector('[data-testid="custom-a"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="custom-b"]')).not.toBeNull();
    expect(container.textContent).toContain("CUSTOM:AAPL");
    // Default cells should NOT have rendered for these rows.
    expect(container.textContent).not.toContain("195.12");
  });

  it("renders emptyState slot when data is empty", () => {
    act(() => {
      root.render(
        <DataTable
          data={[]}
          columns={baseColumns}
          rowKey={(r) => r.id}
          emptyState={<div data-testid="empty">No rows</div>}
        />,
      );
    });
    expect(container.querySelector('[data-testid="empty"]')).not.toBeNull();
    expect(container.querySelector("tbody tr")).toBeNull();
  });

  it("applies column priority classes for non-lg/md/sm columns", () => {
    act(() => {
      root.render(
        <DataTable
          data={sampleData}
          columns={baseColumns}
          rowKey={(r) => r.id}
        />,
      );
    });
    const headerCells = container.querySelectorAll("thead th");
    // First column has no priority — no hidden class.
    expect(headerCells[0]?.className ?? "").not.toContain("hidden");
    // Second column has priority="md".
    expect(headerCells[1]?.className).toContain("hidden");
    expect(headerCells[1]?.className).toContain("md:table-cell");
  });
});
