"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { components } from "@/contracts/customer-auth-v1";
import { authRequest } from "./auth-api";
import { meetsPasswordRules, PasswordChecklist, usernamePattern } from "./customer-password-policy";
import { ErrorMessage } from "./error-message";
import { FileUpload } from "./file-upload";
import { Icon } from "./icons";
import { PasswordField } from "./password-field";

export type CustomerAccount = components["schemas"]["CustomerAccount"];

const accountPath = "auth/customer/account";
const avatarTypes = ["image/jpeg", "image/png", "image/webp"];
const maxAvatarBytes = 2 * 1024 * 1024;
const changeDate = new Intl.DateTimeFormat("en-MY", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur",
});

function avatarUrl(version: string | null) {
  return version ? "/api/v1/" + accountPath + "/photo?v=" + encodeURIComponent(version) : undefined;
}

export function ProfileAvatar({ source, version = null, name }: { source?: string; version?: string | null; name?: string | null }) {
  const initial = [...(name?.trim() ?? "")][0]?.toLocaleUpperCase();
  const image = source ?? avatarUrl(version);
  return <span className="profile-avatar">
    {image ? <img src={image} alt="Profile picture" width={104} height={104} />
      : <span aria-hidden="true">{initial || <Icon name="user" size={38} />}</span>}
  </span>;
}

function encodeAvatar(file: File): Promise<{ mediaType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the profile picture."));
    reader.onload = () => {
      const encoded = typeof reader.result === "string" ? reader.result.split(",", 2)[1] : undefined;
      if (encoded) resolve({ mediaType: file.type, data: encoded });
      else reject(new Error("Could not read the profile picture."));
    };
    reader.readAsDataURL(file);
  });
}

export function CustomerProfileCard({ initialProfile, csrfToken, startEditing = false }: {
  initialProfile: CustomerAccount;
  csrfToken: string;
  startEditing?: boolean;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [editing, setEditing] = useState(startEditing);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  function closeEditor() {
    restoreFocus.current = true;
    setEditing(false);
  }

  return <section className="surface account-panel" aria-labelledby="profile-heading">
    <header className="account-panel-heading">
      <h2 id="profile-heading">Profile</h2>
      {!editing && <button ref={editButton} type="button" className="button-quiet account-edit-button"
        aria-label="Edit profile" onClick={() => { setSaved(false); setEditing(true); }}>
        <Icon name="edit" size={19} />
      </button>}
    </header>
    {editing ? <EditCustomerProfile profile={profile} csrfToken={csrfToken} onCancel={closeEditor}
      onSaved={updated => {
        setProfile(updated);
        setSaved(true);
        closeEditor();
        router.refresh();
      }} /> : <div className="account-overview">
      <ProfileAvatar version={profile.avatarVersion} name={profile.displayName} />
      <dl>
        <div><dt>Display name</dt><dd>{profile.displayName ?? "Not set"}</dd></div>
        <div><dt>Username</dt><dd>{profile.username ? "@" + profile.username : "Not set"}</dd></div>
        <div><dt>Phone number</dt><dd>{profile.phone ?? "Not set"}</dd></div>
        <div><dt>Email</dt><dd>{profile.email ?? "Not set"}</dd></div>
      </dl>
    </div>}
    {saved && <p role="status">Profile saved.</p>}
  </section>;
}

function EditCustomerProfile({ profile, csrfToken, onSaved, onCancel }: {
  profile: CustomerAccount;
  csrfToken: string;
  onSaved: (profile: CustomerAccount) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(profile.displayName ?? "");
  const [username, setUsername] = useState(profile.username ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const usernameLocked = profile.username === null || profile.usernameChangeAvailableAt !== null;
  const preview = photo?.preview ?? (removePhoto ? undefined : avatarUrl(profile.avatarVersion));

  useEffect(() => {
    if (photo) return () => URL.revokeObjectURL(photo.preview);
  }, [photo]);

  function choosePhoto(file: File) {
    if (!avatarTypes.includes(file.type) || file.size > maxAvatarBytes) {
      setError("Choose a JPEG, PNG or WebP image up to 2 MB.");
      return;
    }
    setError("");
    setRemovePhoto(false);
    setPhoto({ file, preview: URL.createObjectURL(file) });
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const contactPhone = phone.replace(/[\s().-]/g, "");
    if (phone && !/^\+[1-9][0-9]{7,14}$/.test(contactPhone)) {
      setError("Enter your phone number with its country code, such as +60.");
      event.currentTarget.querySelector<HTMLInputElement>('input[name="phone"]')?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const savedProfile = await authRequest<CustomerAccount>(accountPath, {
        displayName: name.trim(),
        ...(!usernameLocked && username.toLowerCase() !== profile.username ? { username } : {}),
        ...(contactPhone && contactPhone !== profile.phone ? { phone: contactPhone } : {}),
        ...(email.trim() !== (profile.email ?? "") ? { email: email.trim() || null } : {}),
        ...(photo ? { avatar: await encodeAvatar(photo.file) } : removePhoto ? { avatar: null } : {}),
      }, { method: "PUT", csrfToken });
      onSaved(savedProfile);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="form-stack account-form" onSubmit={saveProfile}>
    <div className="account-photo-controls">
      <ProfileAvatar source={preview} name={name} />
      <div className="account-file">
        <FileUpload id="profile-photo" label="Profile picture" accept={avatarTypes} maxBytes={maxAvatarBytes}
          help="JPEG, PNG or WebP · Up to 2 MiB" hint="Ready to save with your profile."
          file={photo?.file ?? null} disabled={busy} busy={busy}
          onFileChange={file => { if (file) choosePhoto(file); else setPhoto(null); }} />
        {preview && <button type="button" className="button-quiet" disabled={busy} onClick={() => {
          setPhoto(null);
          setRemovePhoto(true);
        }}>Remove picture</button>}
      </div>
    </div>
    <label htmlFor="profile-display-name">Display name</label>
    <input id="profile-display-name" autoComplete="nickname" maxLength={120} value={name} autoFocus
      onChange={event => setName(event.target.value)} required disabled={busy} />
    <label htmlFor="profile-username">Username</label>
    <input id="profile-username" autoComplete="username" autoCapitalize="none" spellCheck={false}
      minLength={3} maxLength={32} pattern={usernamePattern} value={username}
      onChange={event => setUsername(event.target.value)} readOnly={usernameLocked} required={!usernameLocked}
      disabled={busy} aria-describedby="profile-username-help" />
    <small id="profile-username-help">
      {profile.username === null ? "This account uses phone login."
        : profile.usernameChangeAvailableAt
          ? "You can change your username again on " + changeDate.format(new Date(profile.usernameChangeAvailableAt)) + " (MYT)."
          : "You can change your username once every 60 days."}
    </small>
    <label htmlFor="profile-contact-phone">Phone number</label>
    <input id="profile-contact-phone" name="phone" type="tel" autoComplete="tel" maxLength={32} value={phone}
      onChange={event => setPhone(event.target.value)} required={profile.phone !== null} disabled={busy}
      aria-describedby="profile-phone-help" />
    <small id="profile-phone-help">Include the country code, such as +60. This is your contact number.</small>
    <label htmlFor="profile-email">Email <small>(optional)</small></label>
    <input id="profile-email" type="email" autoComplete="email" maxLength={254} value={email}
      onChange={event => setEmail(event.target.value)} disabled={busy} />
    <div className="actions">
      <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      <button type="button" className="button-quiet" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
    {error && <ErrorMessage>{error}</ErrorMessage>}
  </form>;
}

export function ChangeCustomerPassword({ csrfToken }: { csrfToken: string }) {
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const canConfirm = meetsPasswordRules(newPassword);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaved(false);
    if (!canConfirm) {
      setError("Meet all five password requirements before continuing.");
      return;
    }
    if (newPassword !== data.get("confirmPassword")) {
      setError("The new passwords do not match.");
      const confirmation = form.elements.namedItem("confirmPassword");
      if (confirmation instanceof HTMLInputElement) confirmation.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await authRequest<void>(accountPath + "/password", {
        currentPassword: data.get("currentPassword"), newPassword,
      }, { csrfToken });
      form.reset();
      setNewPassword("");
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change your password.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="form-stack account-form" onSubmit={changePassword} onChange={() => setSaved(false)}>
    <PasswordField id="security-current-password" name="currentPassword" label="Current password"
      autoComplete="current-password" maxLength={128} required disabled={busy} />
    <PasswordField id="security-new-password" name="newPassword" label="New password"
      autoComplete="new-password" maxLength={128} required disabled={busy} value={newPassword}
      onChange={event => setNewPassword(event.target.value)} aria-describedby="security-password-help" />
    <PasswordChecklist id="security-password-help" password={newPassword} />
    <PasswordField id="security-confirm-password" name="confirmPassword" label="Confirm new password"
      autoComplete="new-password" maxLength={128} required disabled={busy || !canConfirm} />
    <button type="submit" disabled={busy}>{busy ? "Changing password…" : "Change password"}</button>
    {saved && <p role="status">Password changed. You’ve been logged out on other devices.</p>}
    {error && <ErrorMessage>{error}</ErrorMessage>}
  </form>;
}
