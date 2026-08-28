"use client";

import { useSearchParams } from "next/navigation";

/**
 * The header's search field.
 *
 * Split out as the one client component in the header so the rest of it stays
 * a server component. It exists only to keep the box filled with what was
 * searched — arriving on a results page to an empty search box makes refining
 * a query mean retyping it.
 *
 * `key` forces a fresh uncontrolled input when the query changes, so the value
 * follows navigation without the field becoming controlled state.
 */
export function SearchInput() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";

  return (
    <input
      key={q}
      id="site-search"
      name="q"
      type="search"
      defaultValue={q}
      placeholder="ค้นหาสินค้าที่อยากประมูล"
      className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/45"
    />
  );
}
