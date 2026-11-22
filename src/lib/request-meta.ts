// Ответ менеджера хранится в том же поле comment, что и комментарий сотрудника,
// после служебной метки. Так не нужно менять базу данных.
const MARKER = "\n§§MANAGER§§";

export function splitComment(raw: string | null | undefined): {
  text: string;
  managerNote: string;
} {
  const value = raw ?? "";
  const index = value.indexOf(MARKER);

  if (index === -1) {
    return { text: value.trim(), managerNote: "" };
  }

  return {
    text: value.slice(0, index).trim(),
    managerNote: value.slice(index + MARKER.length).trim(),
  };
}

export function joinComment(text: string, managerNote: string): string | null {
  const cleanText = text.trim();
  const cleanNote = managerNote.trim();

  if (!cleanNote) return cleanText || null;

  return `${cleanText}${MARKER}${cleanNote}`;
}
