/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import "./haigaEditor.css";
import { Confirmation, Loading } from "../admin";

interface Haiga {
  id: string;
  title: string;
  lines: Array<string>;
  image: string;
  publisher: string;
}

interface HaigaEditorProps {
  isLoading: boolean;
  setLoading: (loading: Loading) => void;
  isConfirming: boolean;
  setConfirmation: (confirmation: Confirmation) => void;
}

function HaigaEditor(props: HaigaEditorProps) {

  useEffect(() => {
    const getHaikus = async () => {
      props.setLoading({ isLoading: true, message: "Loading haiku..." });
      const token = await getAccessTokenSilently();
      const response = await fetch("http://localhost:3000/haiku", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data: Array<Haiku> = await response.json();
      console.log(data);
      setHaikuList(data);
      props.setLoading({ isLoading: false, message: "" });
    };
    getHaikus();
  }, []);

  return <>Haiga Editor</>;
}

export default HaigaEditor;
