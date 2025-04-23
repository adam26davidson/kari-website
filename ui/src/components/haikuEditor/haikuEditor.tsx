import { Haiku } from "../../Models";

export function HaikuEditor(props: {
  newHaiku: Haiku;
  setNewHaiku: (haiku: Haiku) => void;
}) {
  return (
    <>
      <textarea
        value={props.newHaiku.lines.join("\n")}
        placeholder={"line 1\nline 2\nline 3"}
        onChange={(e) =>
          props.setNewHaiku({
            ...props.newHaiku,
            lines: e.target.value.split("\n"),
          })
        }
      />
      <input
        type="text"
        placeholder="Publisher"
        value={props.newHaiku.publisher}
        onChange={(e) =>
          props.setNewHaiku({ ...props.newHaiku, publisher: e.target.value })
        }
      />
    </>
  );
}
