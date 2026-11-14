# Customer authentication extension

Requested 12 November 2026. This extends the signed R2 baseline, which originally treated the verified phone number as the customer identity without a separate registration form.

| Journey | Required input and outcome |
| --- | --- |
| Sign up | Display name, username, international phone number, optional email, password and password confirmation. The confirmation is checked in the form and is not sent to the API. Verify the phone OTP before saving the profile or opening a session. An existing phone-only customer can register credentials for the same account after proving phone ownership. |
| Log in by phone | Verify an OTP for an existing customer account. No customer or profile is created. |
| Log in by username | Verify a case-insensitive username and password, then open the same customer session used by phone login. Phone login remains available if a customer forgets their password. |

While customer phone verification is paused, the storefront shows username and password login and creates new accounts from the sign-up form without an OTP. Migration 0005 stores the submitted phone number as an unverified contact, separate from verified phone login. Existing verified accounts retain ownership of their phone numbers. Set `SWEETCOMMERCE_CUSTOMER_PHONE_VERIFICATION=true` on the frontend and API to show phone login and require a verified phone for sign-up again.

Fulfilment addresses remain part of the order or event request. The customer paths do not grant merchant access. Merchant sign-up sets credentials for the existing administrator after verifying their enrolled contact. The merchant can then sign in with username and password. Contact-based sign-in and recovery remain available, and recovery clears the merchant password so the verified administrator can set it again.

The storefront header reads the display name from the signed-in customer's profile. The username identifies the customer during password log-in. The profile response exposes only the display name and is scoped to the active customer session.

The header account link opens the customer's private Profile page. Customers can edit their display name and picture, and change an existing username once every 60 days. A password change checks the current password, uses the same new-password rules as sign-up, and revokes other sessions while keeping the current one. Profile photos are stored as bounded thumbnails in PostgreSQL and served only to their owner.

Migration 0004 adds a customer profile linked to the existing account ID, and a bounded PostgreSQL attempt counter for password log-in. Registration and session creation share one transaction. The database enforces unique usernames and one profile per account. Passwords are stored only as salted Argon2id hashes. Log-in and sign-up OTPs are scoped to their purpose and consumed once. The legacy phone API can still open existing accounts but does not create accounts. Clients implementing registration should use the [customer authentication OpenAPI extension](contracts/customer-auth-v1.openapi.json).
