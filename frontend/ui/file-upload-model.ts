export function uploadSelectionIssue(files: readonly Pick<File, "size" | "type">[], types: readonly string[], maxBytes: number): string | null {
  if (files.length !== 1) return "Choose one file at a time.";
  if (!types.includes(files[0].type)) return "This file type is not supported. Choose one of the formats listed below.";
  if (files[0].size === 0) return "This file is empty. Choose another file.";
  if (files[0].size > maxBytes) return `This file is too large. Choose a file up to ${maxBytes / (1024 * 1024)} MiB.`;
  return null;
}

export function uploadFileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
