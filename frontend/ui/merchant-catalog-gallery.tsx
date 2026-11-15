import { useEffect, useRef, useState } from "react";
import { ErrorMessage } from "./error-message";
import { FileUpload } from "./file-upload";
import { Icon } from "./icons";
import { maxPhotos, photoPath, photoTypes } from "./merchant-catalog-model";

function PhotoPreview({ productId, id, position }: { productId: string; id: string; position: number }) {
  const [failed, setFailed] = useState(false);
  const label = position === 1 ? "Cover photo" : `Product photo ${position}`;

  return failed ? (
    <ErrorMessage><p>{label} preview unavailable.{" "}
      <button type="button" onClick={() => setFailed(false)}>Retry preview</button>
    </p></ErrorMessage>
  ) : (
    // Use the same-origin, session-protected URL directly so the browser sends the merchant cookie.
    <img className="product-photo-preview" src={photoPath(productId, id)} alt={label} width={320} height={240} loading="lazy"
      onError={() => setFailed(true)} />
  );
}

export function SavedGallery({ productId, ids }: { productId: string; ids: string[] }) {
  return ids.length === 0 ? <p>No saved photos.</p> : (
    <ol className="product-photo-grid product-saved-gallery">
      {ids.map((id, index) => <li key={id}><PhotoPreview productId={productId} id={id} position={index + 1} /></li>)}
    </ol>
  );
}

export function GalleryEditor({ productId, ids, savedIds, onUpload, onMove, onRemove, issue, busy = false }: {
  productId: string;
  ids: string[];
  savedIds: string[];
  onUpload: (file: File, index: number | null) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  issue?: string;
  busy?: boolean;
}) {
  const chooseButton = useRef<HTMLButtonElement>(null);
  const [replacement, setReplacement] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const changed = ids.length !== savedIds.length || ids.some((id, index) => id !== savedIds[index]);

  function chooseReplacement(index: number) {
    setFile(null);
    setReplacement(index);
  }

  useEffect(() => {
    setReplacement(null);
    setFile(null);
  }, [ids]);

  useEffect(() => {
    if (replacement !== null) chooseButton.current?.focus();
  }, [replacement]);

  return (
    <fieldset className="surface product-gallery" id="imageRefs" tabIndex={-1} aria-describedby={issue ? "gallery-help gallery-error" : "gallery-help"}>
      <legend className="visually-hidden">Product gallery</legend>
      <div className="product-section-heading"><span className="product-section-icon"><Icon name="grid" size={22} /></span><div><h2>Product photos</h2><p>Make the first photo your best first impression.</p></div><span className="product-count">{ids.length} / {maxPhotos}</span></div>
      <p id="gallery-help">Up to {maxPhotos} JPEG, PNG or WebP photos, 5 MiB each. The first photo is the cover. Save the product to apply the gallery.</p>
      {issue && <p id="gallery-error">{issue}</p>}
      {changed && <p className="product-unsaved">Gallery changes are unsaved.</p>}
      {ids.length === 0 ? <div className="product-empty"><Icon name="cake" size={28} /><h3>A photo worth a first bite</h3><p>Add a product photo. Your first upload becomes the cover.</p></div> : (
        <ol className="product-photo-grid">
          {ids.map((id, index) => (
            <li key={id} tabIndex={-1}>
              <p className="product-photo-label">Photo {index + 1}<span>{index === 0 ? "Cover" : ""}{!savedIds.includes(id) ? (index === 0 ? " · Staged" : "Staged") : ""}</span></p>
              <PhotoPreview productId={productId} id={id} position={index + 1} />
              <div className="product-photo-actions">
                <button className="button-secondary" type="button" disabled={index === 0} aria-label={`Move photo ${index + 1} earlier`} onClick={event => {
                  event.currentTarget.closest("li")?.focus();
                  onMove(index, index - 1);
                }}><Icon name="up" size={16} /> Earlier</button>
                <button className="button-secondary" type="button" disabled={index === ids.length - 1} aria-label={`Move photo ${index + 1} later`} onClick={event => {
                  event.currentTarget.closest("li")?.focus();
                  onMove(index, index + 1);
                }}>Later <Icon name="down" size={16} /></button>
                <button className="button-quiet" type="button" aria-label={`Replace photo ${index + 1}`} onClick={() => chooseReplacement(index)}>Replace</button>
                <button className="button-quiet" type="button" aria-label={`Remove photo ${index + 1}`} onClick={event => {
                  if (chooseButton.current?.disabled) event.currentTarget.closest("fieldset")?.focus();
                  else chooseButton.current?.focus();
                  onRemove(index);
                }}>Remove</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {ids.length >= maxPhotos && replacement === null && <p>Gallery is full. Replace or remove a photo to add another.</p>}
      <div className="product-photo-upload">
        <FileUpload key={replacement ?? "add"} id="catalogue-photo" buttonRef={chooseButton}
          label={replacement === null ? "Add a product photo" : `Replace photo ${replacement + 1}`}
          accept={photoTypes} maxBytes={5 * 1024 * 1024} help="JPEG, PNG or WebP · Up to 5 MiB · One photo at a time"
          hint="Ready to upload. Save the product afterwards to apply your gallery."
          file={file} onFileChange={setFile} busy={busy} disabled={replacement === null && ids.length >= maxPhotos} />
        <div className="product-upload-actions">
          <button type="button" disabled={!file || busy} onClick={() => file && onUpload(file, replacement)}>
            <Icon name="upload" size={16} />{busy ? "Uploading…" : replacement === null ? "Upload photo" : "Upload replacement"}
          </button>
          {replacement !== null && <button className="button-quiet" type="button" disabled={busy} onClick={() => {
            setReplacement(null); setFile(null);
          }}>Cancel replacement</button>}
        </div>
      </div>
      {changed && (
        <details>
          <summary>View currently saved gallery</summary>
          <SavedGallery productId={productId} ids={savedIds} />
        </details>
      )}
    </fieldset>
  );
}
