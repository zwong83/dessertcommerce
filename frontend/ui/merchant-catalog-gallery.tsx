import { useEffect, useRef, useState } from "react";
import { ErrorMessage } from "./error-message";
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
    <img src={photoPath(productId, id)} alt={label} width={144} height={108} loading="lazy"
      style={{ maxWidth: "100%", objectFit: "contain" }} onError={() => setFailed(true)} />
  );
}

export function SavedGallery({ productId, ids }: { productId: string; ids: string[] }) {
  return ids.length === 0 ? <p>No saved photos.</p> : (
    <ol className="item-list">
      {ids.map((id, index) => <li key={id}><PhotoPreview productId={productId} id={id} position={index + 1} /></li>)}
    </ol>
  );
}

export function GalleryEditor({ productId, ids, savedIds, onUpload, onMove, onRemove, issue }: {
  productId: string;
  ids: string[];
  savedIds: string[];
  onUpload: (file: File, index: number | null) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  issue?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [replacement, setReplacement] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const changed = ids.length !== savedIds.length || ids.some((id, index) => id !== savedIds[index]);

  function chooseReplacement(index: number) {
    setFile(null);
    setReplacement(index);
    if (input.current) {
      input.current.value = "";
      input.current.focus();
    }
  }

  useEffect(() => {
    setReplacement(null);
    setFile(null);
    if (input.current) input.current.value = "";
  }, [ids]);

  return (
    <fieldset id="imageRefs" tabIndex={-1} aria-describedby={issue ? "gallery-help gallery-error" : "gallery-help"}
      style={{ minWidth: 0 }}>
      <legend>Product gallery</legend>
      <p id="gallery-help">Up to {maxPhotos} JPEG, PNG or WebP photos, 5 MiB each. The first photo is the cover. Save the product to apply the gallery.</p>
      {issue && <p id="gallery-error">{issue}</p>}
      {changed && <p>Gallery changes are unsaved.</p>}
      {ids.length === 0 ? <p>No photos in this gallery.</p> : (
        <ol className="item-list">
          {ids.map((id, index) => (
            <li key={id} tabIndex={-1}>
              <p>Photo {index + 1}{index === 0 ? " · Cover" : ""}{!savedIds.includes(id) ? " · Staged" : ""}</p>
              <PhotoPreview productId={productId} id={id} position={index + 1} />
              <div>
                <button type="button" disabled={index === 0} aria-label={`Move photo ${index + 1} earlier`} onClick={event => {
                  event.currentTarget.closest("li")?.focus();
                  onMove(index, index - 1);
                }}>Move earlier</button>{" "}
                <button type="button" disabled={index === ids.length - 1} aria-label={`Move photo ${index + 1} later`} onClick={event => {
                  event.currentTarget.closest("li")?.focus();
                  onMove(index, index + 1);
                }}>Move later</button>{" "}
                <button type="button" aria-label={`Replace photo ${index + 1}`} onClick={() => chooseReplacement(index)}>Replace</button>{" "}
                <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={event => {
                  if (input.current?.disabled) event.currentTarget.closest("fieldset")?.focus();
                  else input.current?.focus();
                  onRemove(index);
                }}>Remove</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {ids.length >= maxPhotos && replacement === null && <p>Gallery is full. Replace or remove a photo to add another.</p>}
      <p>
        <label htmlFor="catalogue-photo">{replacement === null ? "Choose a photo to add" : `Choose a replacement for photo ${replacement + 1}`}</label><br />
        <input id="catalogue-photo" ref={input} type="file" accept={photoTypes.join(",")}
          disabled={replacement === null && ids.length >= maxPhotos} aria-describedby="gallery-help"
          onChange={event => setFile(event.target.files?.[0] ?? null)} />
      </p>
      <button type="button" disabled={!file} onClick={() => file && onUpload(file, replacement)}>
        {replacement === null ? "Upload photo" : "Upload replacement"}
      </button>{" "}
      {replacement !== null && <button type="button" onClick={() => {
        setReplacement(null);
        setFile(null);
        if (input.current) input.current.value = "";
      }}>Cancel replacement</button>}
      {changed && (
        <details>
          <summary>View currently saved gallery</summary>
          <SavedGallery productId={productId} ids={savedIds} />
        </details>
      )}
    </fieldset>
  );
}
