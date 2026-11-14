export const usernamePattern = "[A-Za-z0-9][A-Za-z0-9_.\\-]{2,31}";

const passwordRules = [
  { label: "At least 8 characters", meets: (password: string) => [...password].length >= 8 },
  { label: "At least one lowercase letter", meets: (password: string) => /[a-z]/.test(password) },
  { label: "At least one uppercase letter", meets: (password: string) => /[A-Z]/.test(password) },
  { label: "At least one number", meets: (password: string) => /[0-9]/.test(password) },
  { label: "At least one symbol (such as !, @ or #)", meets: (password: string) => /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(password) },
];

export function meetsPasswordRules(password: string) {
  return passwordRules.every(rule => rule.meets(password));
}

export function PasswordChecklist({ id, password }: { id: string; password: string }) {
  return <ul className="password-checklist" id={id} role="list" aria-label="Password requirements">
    {passwordRules.map(({ label, meets }) => {
      const met = meets(password);
      return <li key={label} data-met={met}>
        <span role="img" aria-label={met ? "Met" : "Not yet met"}>{met ? "✓" : "○"}</span>
        {label}
      </li>;
    })}
  </ul>;
}
