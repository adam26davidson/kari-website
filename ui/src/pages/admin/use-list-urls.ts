import { useLocation } from "react-router-dom";

/**
 * The URLs of one admin section's list and its item editors, carrying the
 * current search string along.
 *
 * The list's search box keeps its query in `?q=` (see AdminItemList), so
 * carrying the search string into the editor URL and back out again is what
 * returns the user to the view she left rather than to the whole list.
 */
export function useListUrls(listPath: string) {
  const { search } = useLocation();
  return {
    listUrl: `${listPath}${search}`,
    itemUrl: (id: string) => `${listPath}/${id}${search}`,
  };
}
