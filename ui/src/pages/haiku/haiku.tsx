import "./haiku.css";
// import HaikuZenViewer from "../../components/haikuZenViewer/haikuZenviewer";
import HaikuList from "../../components/haikuList/haikuList";

const haiku = [
  ["what's left", "of the afternoon", "empty pea pods"],
  ["first cherry blossoms", "a child’s breath", "on the windowpane"],
  ["drifting cherry petals", "for a moment", "we let down our masks"],
];

function Haiku() {
  return (
  <div className="haiku-container"><HaikuList haikuList={haiku} /></div>);
}

export default Haiku;
