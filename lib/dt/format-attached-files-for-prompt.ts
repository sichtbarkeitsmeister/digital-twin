export function formatAttachedFilesForPrompt(
  files: Array<{ fileName: string; text?: string | null }>,
): string {
  if (files.length === 0) return "";
  return files
    .map((file) => {
      const name = file.fileName.trim() || "Anhang";
      const body =
        file.text?.trim() ||
        "(Datei ist angehängt. Der Inhalt konnte nicht als Text gelesen werden — trotzdem als vorhandene Datei behandeln.)";
      return `--- Angehängte Datei: ${name} ---\n${body}`;
    })
    .join("\n\n");
}
