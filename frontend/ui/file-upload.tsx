"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";
import { ErrorMessage } from "./error-message";
import { Icon } from "./icons";
import { uploadFileSize, uploadSelectionIssue } from "./file-upload-model";

type Props = {
  id?: string;
  name?: string;
  label: string;
  accept: readonly string[];
  maxBytes: number;
  help: string;
  hint?: string;
  file?: File | null;
  onFileChange?: (file: File | null) => void;
  disabled?: boolean;
  busy?: boolean;
  required?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  resetKey?: unknown;
};

export function FileUpload({ id, name, label, accept, maxBytes, help, hint = "Select a file, then submit when you’re ready.",
  file, onFileChange, disabled = false, busy = false, required = false, buttonRef, resetKey }: Props) {
  const generatedId = useId();
  const inputId = id ?? `upload-${generatedId}`;
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement | null>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [error, setError] = useState<{ message: string; key: number } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const selected = file === undefined ? localFile : file;
  const unavailable = disabled || busy;

  useEffect(() => {
    setLocalFile(null);
    setError(null);
    if (input.current) input.current.value = "";
  }, [resetKey]);

  useEffect(() => {
    if (!selected) {
      if (input.current) input.current.value = "";
      setPreview(null);
      return;
    }
    if (!selected.type.startsWith("image/")) { setPreview(null); return; }
    const url = URL.createObjectURL(selected);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);

  useEffect(() => {
    const form = input.current?.form;
    const reset = () => { setLocalFile(null); setError(null); setDragging(false); onFileChange?.(null); };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [onFileChange]);

  function isDisabled() {
    // A disabled ancestor fieldset also locks drag/drop, not just native clicks.
    return unavailable || !!input.current?.matches(":disabled");
  }
  function report(message: string) {
    setError(previous => ({ message, key: (previous?.key ?? 0) + 1 }));
  }
  function selectFiles(files: File[]) {
    if (isDisabled() || !files.length) return;
    const issue = uploadSelectionIssue(files, accept, maxBytes);
    if (issue) {
      if (input.current) input.current.value = "";
      setLocalFile(null);
      onFileChange?.(null);
      report(issue);
      return;
    }
    // Keep the real input in sync so existing FormData submission works for drops.
    if (input.current) {
      const transfer = new DataTransfer();
      transfer.items.add(files[0]);
      input.current.files = transfer.files;
    }
    setError(null);
    setLocalFile(files[0]);
    onFileChange?.(files[0]);
  }
  function remove() {
    if (isDisabled()) return;
    if (input.current) input.current.value = "";
    setLocalFile(null);
    setError(null);
    onFileChange?.(null);
    choose.current?.focus();
  }

  return <div className="file-upload" data-disabled={unavailable || undefined}>
    <span className="file-upload-label" id={`${inputId}-label`}>{label}{required && <span>Required</span>}</span>
    <div className="file-upload-zone" data-dragging={dragging && !unavailable || undefined}
      role="group" aria-labelledby={`${inputId}-label`} aria-describedby={`${inputId}-help`} aria-busy={busy}
      onDragEnter={event => {
        event.preventDefault(); event.stopPropagation();
        if (isDisabled() || !event.dataTransfer.types.includes("Files")) return;
        dragDepth.current += 1; setDragging(true);
      }}
      onDragOver={event => {
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = isDisabled() ? "none" : "copy";
      }}
      onDragLeave={event => {
        event.preventDefault(); event.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={event => {
        event.preventDefault(); event.stopPropagation();
        dragDepth.current = 0; setDragging(false);
        selectFiles(Array.from(event.dataTransfer.files));
      }}>
      <input id={inputId} name={name} ref={input} type="file" className="visually-hidden" tabIndex={-1}
        accept={accept.join(",")} required={required} disabled={unavailable}
        aria-labelledby={`${inputId}-label`} aria-describedby={`${inputId}-help`} aria-invalid={!!error}
        onInvalid={event => { event.preventDefault(); report("Choose a file before submitting."); choose.current?.focus(); }}
        onChange={event => selectFiles(Array.from(event.currentTarget.files ?? []))} />
      {selected ? <div className="file-upload-selection">
        <div className="file-upload-thumbnail">{preview
          ? <img src={preview} alt="Selected file preview" width={80} height={80} onError={() => setPreview(null)} />
          : <Icon name={selected.type === "application/pdf" ? "list" : "upload"} size={28} />}</div>
        <div className="file-upload-file"><strong>{selected.name}</strong><span>{uploadFileSize(selected.size)} · {selected.type === "application/pdf" ? "PDF document" : "Image"}</span></div>
        <button type="button" className="button-quiet file-upload-remove" aria-label={`Remove selected file ${selected.name}`} disabled={unavailable} onClick={remove}><Icon name="close" size={18} /></button>
      </div> : <><span className="file-upload-icon"><Icon name="upload" size={25} /></span>
        <strong className="file-upload-title">{dragging ? "Drop your file here" : "Drag & drop your file here"}</strong>
        <span className="file-upload-or">or browse from your device</span></>}
      <button ref={node => {
        choose.current = node;
        if (typeof buttonRef === "function") buttonRef(node);
        else if (buttonRef) buttonRef.current = node;
      }} type="button" className="button-secondary file-upload-choose" disabled={unavailable}
        aria-describedby={`${inputId}-help`} onClick={() => input.current?.click()}>
        <Icon name="upload" size={16} />{selected ? "Change file" : "Choose file"}
      </button>
      <p id={`${inputId}-help`} className="file-upload-help">{help}</p>
    </div>
    <p className="file-upload-hint" role="status">{busy ? "Processing your file…" : selected ? hint : ""}</p>
    {error && <><p className="file-upload-error">{error.message}</p><ErrorMessage key={error.key}>{error.message}</ErrorMessage></>}
  </div>;
}
