/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import "./editorList.css";
import "../editorListItem/editorListItem.css";
import "../../pages/admin/admin.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import { Confirmation, Loading } from "../../pages/admin/admin";
import EditorListItem from "../editorListItem/editorListItem";

interface EditorListProps<T> {
  dataList: Array<T>;
  newItem: T;
  isLoading: boolean;
  isConfirming: boolean;
  setDataList: (newDataList: Array<T>) => void;
  setLoading: (loading: Loading) => void;
  setConfirmation: (confirmation: Confirmation) => void;
  loadData: () => Promise<void>;
  saveData: (newDataList: Array<T>) => Promise<void>;
  saveNewItem: (newItem: T) => Promise<void>;
  newItemIsValid: () => boolean;
  itemEditor: () => JSX.Element;
  itemContent: (idx: number) => JSX.Element;
}

function EditorList<T>({
  dataList,
  newItem,
  isLoading,
  isConfirming,
  setDataList,
  setLoading,
  setConfirmation,
  loadData,
  saveData,
  saveNewItem,
  newItemIsValid,
  itemEditor,
  itemContent,
}: EditorListProps<T>) {
  const [addingItem, setAddingItem] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading({ isLoading: true, message: "Loading..." });
      await loadData();
      setLoading({ isLoading: false, message: "" });
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
    saveData(newDataList);
    setDataList(newDataList);
    return;
  };

  const addNewItem = () => {
    saveNewItem(newItem);
    setAddingItem(false);
  };

  const cancelNewItem = () => {
    setAddingItem(false);
  };

  const deleteItem = (idx: number) => () => {
    setConfirmation({
      show: true,
      message: "Are you sure you want to delete this item?",
      options: [
        {
          label: "Yes",
          callback: () => {
            const newDataList = dataList.slice();
            newDataList.splice(idx, 1);
            saveData(newDataList);
            setDataList(newDataList);
          },
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
    !isConfirming && (
      <>
        <div className="editor-list-container">
          <div className="editor-list">
            {!addingItem && (
              <div
                className="admin-icon-button"
                onClick={() => setAddingItem(!addingItem)}
              >
                <FontAwesomeIcon icon={faPlus} />
              </div>
            )}
            {addingItem && (
              <div className="editor-list-item">
                <div className="editor-list-item-inputs">{itemEditor()}</div>
                <div className="editor-list-item-controls">
                  <div
                    className={`admin-icon-button${newItemIsValid() ? "" : " disabled"}`}
                    onClick={newItemIsValid() ? addNewItem : () => {}}
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
              <EditorListItem
                key={idx}
                idx={idx}
                isFirst={idx === 0}
                isLast={idx === dataList.length - 1}
                moveItem={moveItem}
                deleteItem={deleteItem(idx)}
              >
                {itemContent(idx)}
              </EditorListItem>
            ))}
          </div>
        </div>
      </>
    )
  );
}

export default EditorList;
