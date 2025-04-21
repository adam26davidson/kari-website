/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import "./dataList.css";
import "../dataListItem/dataListItem.css";
import "../../pages/admin/admin.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { Confirmation, Loading } from "../../pages/admin/admin";
import DataListItem from "../dataListItem/dataListItem";

interface AdminDataListProps<T> {
  newItem: T;
  isConfirming: boolean;
  setDataList: (newDataList: Array<T>) => void;
  setLoading: (loading: Loading) => void;
  setConfirmation: (confirmation: Confirmation) => void;
  loadData: () => Promise<void>;
  saveData: (newDataList: Array<T>) => Promise<void>;
  saveNewItem: (newItem: T) => Promise<void>;
  deleteItem: (idx: number) => () => Promise<void>;
  newItemIsValid: () => boolean;
  itemEditor: () => JSX.Element;
}

interface DataListProps<T> {
  dataList: Array<T>;
  isLoading: boolean;
  isAdmin: boolean;
  itemContent: (idx: number) => JSX.Element;
  adminProps?: AdminDataListProps<T>;
}

function DataList<T>({
  dataList,
  isLoading,
  isAdmin,
  itemContent,
  adminProps,
}: DataListProps<T>) {
  const [addingItem, setAddingItem] = useState(false);

  useEffect(() => {
    const load = async () => {
      adminProps?.setLoading({ isLoading: true, message: "Loading..." });
      await adminProps?.loadData();
      adminProps?.setLoading({ isLoading: false, message: "" });
    };
    load();
  }, []);

  const moveItem = (idx: number, direction: "up" | "down") => () => {
    const data: T = dataList[idx];
    if (idx === 0 && direction === "up") return;
    if (idx === dataList.length - 1 && direction === "down") return;

    const newDataList = dataList.slice();
    newDataList.splice(idx, 1);
    const offset = direction === "up" ? -1 : 1;
    newDataList.splice(idx + offset, 0, data);
    adminProps?.saveData(newDataList);
    adminProps?.setDataList(newDataList);
    return;
  };

  const addNewItem = () => {
    adminProps?.saveNewItem(adminProps?.newItem);
    setAddingItem(false);
  };

  const cancelNewItem = () => {
    setAddingItem(false);
  };

  const deleteItemWithConfirmation = (idx: number) => () => {
    adminProps?.setConfirmation({
      show: true,
      message: "Are you sure you want to delete this item?",
      options: [
        {
          label: "Yes",
          callback: adminProps?.deleteItem(idx),
        },
        {
          label: "No",
          callback: () => {},
        },
      ],
    });
  };

  return (
    !isLoading &&
    !adminProps?.isConfirming && (
      <>
        <div className="data-list-container">
          <div className={isAdmin ? "admin-data-list" : "data-list fade-in"}>
            {!addingItem && isAdmin && (
              <div
                className="admin-icon-button"
                onClick={() => setAddingItem(!addingItem)}
              >
                <FontAwesomeIcon icon={faPlus} />
              </div>
            )}
            {addingItem && isAdmin && (
              <div className="data-list-item">
                <div className="data-list-item-inputs">
                  {adminProps?.itemEditor()}
                </div>
                <div className="data-list-item-controls">
                  <div
                    className={`admin-icon-button${adminProps?.newItemIsValid() ? "" : " disabled"}`}
                    onClick={
                      adminProps?.newItemIsValid() ? addNewItem : () => {}
                    }
                  >
                    <FontAwesomeIcon icon={faPlus} />
                  </div>
                  <div className="admin-icon-button" onClick={cancelNewItem}>
                    <FontAwesomeIcon icon={faTrash} />
                  </div>
                </div>
              </div>
            )}
            {dataList.map((_curr, idx) => (
              <>
                <DataListItem
                  key={idx}
                  idx={idx}
                  isFirst={idx === 0}
                  isLast={idx === dataList.length - 1}
                  isAdmin={isAdmin}
                  moveItem={moveItem}
                  deleteItem={deleteItemWithConfirmation(idx)}
                >
                  {itemContent(idx)}
                </DataListItem>
                {idx !== dataList.length - 1 && !isAdmin && (
                  <div className="data-list-item-separator" />
                )}
              </>
            ))}
          </div>
        </div>
      </>
    )
  );
}

export default DataList;
