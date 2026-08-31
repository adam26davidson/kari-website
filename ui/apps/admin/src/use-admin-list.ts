import { useEffect, useState } from "react";
import { useAdminToken } from "./hooks/use-admin-token";
import { TokenGetter } from "@kari/shared/services/http";
import { useAdminUi } from "./admin-ui-context";

export interface UseAdminListOptions<T> {
  /** Plural noun used in overlay messages, e.g. "haiku" or "other works". */
  noun: string;
  getList: (getToken: TokenGetter) => Promise<Array<T>>;
  updateList: (list: Array<T>, getToken: TokenGetter) => Promise<void>;
}

export interface AdminList<T> {
  list: Array<T>;
  /**
   * Replaces the local list without persisting — for rollback paths that
   * have already talked to the API themselves.
   */
  setList: (list: Array<T>) => void;
  /**
   * True once the initial load has settled (successfully or not) — lets
   * URL-driven pages hold off judging an editor id until the list is real.
   */
  loaded: boolean;
  loadFailed: boolean;
  load: () => Promise<void>;
  /**
   * Persists newList and, on success, makes it the local list. Toasts on
   * error always; toasts success only when a message is given, so
   * multi-step flows can notify once at the end.
   */
  saveList: (newList: Array<T>, successMessage?: string) => Promise<boolean>;
}

/**
 * The load/save skeleton shared by the admin list pages: list state, a
 * mount-time load with a retryable failure flag, and a save with the
 * standard toast semantics.
 */
export function useAdminList<T extends { id: string }>({
  noun,
  getList,
  updateList,
}: UseAdminListOptions<T>): AdminList<T> {
  const getAccessTokenSilently = useAdminToken();
  const { showLoading, hideLoading, notify } = useAdminUi();
  const [list, setList] = useState<Array<T>>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = async () => {
    showLoading(`Loading ${noun}...`);
    setLoadFailed(false);
    try {
      const data = await getList(getAccessTokenSilently);
      setList(data);
    } catch (error) {
      // Never show an empty editable list after a failed load — saving it
      // would overwrite the real data.
      console.error(error);
      setLoadFailed(true);
    } finally {
      setLoaded(true);
      hideLoading();
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveList = async (
    newList: Array<T>,
    successMessage?: string,
  ): Promise<boolean> => {
    showLoading(`Updating ${noun}...`);
    try {
      await updateList(newList, getAccessTokenSilently);
      setList(newList);
      if (successMessage) {
        notify(successMessage);
      }
      return true;
    } catch (error) {
      console.error(error);
      notify("Failed to save — your change was not saved", "error");
      return false;
    } finally {
      hideLoading();
    }
  };

  return { list, setList, loaded, loadFailed, load, saveList };
}
