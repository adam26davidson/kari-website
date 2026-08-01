export function AdminTextArea({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <textarea
      className="admin-text-area"
      value={value}
      placeholder={placeholder}
      onChange={onChange}
    />
  );
}
