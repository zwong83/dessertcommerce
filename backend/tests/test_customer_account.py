from base64 import b64encode
from datetime import timedelta
from io import BytesIO

from PIL import Image

from conftest import API, ORIGIN
from sweetcommerce.db import iso

ACCOUNT = API + "/auth/customer/account"
AUTH = API + "/auth/customer/"
PASSWORD = "Example1!"


def session_headers(response):
    assert response.is_success, response.text
    return {
        "Origin": ORIGIN, "Cookie": response.headers["set-cookie"].split(";", 1)[0],
        "X-CSRF-Token": response.json()["csrfToken"],
    }


def signup(client, username):
    return session_headers(client.post(AUTH + "registration", headers={"Origin": ORIGIN}, json={
        "registration": {"name": "Customer", "username": username, "password": PASSWORD},
        "phone": "+60000000003",
    }))


def login(client, username, password):
    return client.post(AUTH + "password", headers={"Origin": ORIGIN}, json={"username": username, "password": password})


def test_profile_requires_customer_session_and_csrf(client, sign_in):
    assert client.get(ACCOUNT).status_code == 401
    _, merchant = sign_in(role="ADMIN")
    assert client.get(ACCOUNT, headers=merchant).status_code == 403
    assert client.get(ACCOUNT + "/photo", headers=merchant).status_code == 403
    headers = signup(client, "first.customer")
    assert client.put(ACCOUNT, headers={**headers, "X-CSRF-Token": "wrong"},
                      json={"displayName": "Updated"}).status_code == 403
    assert client.put(ACCOUNT, headers={**headers, "Origin": "https://other.example.test"},
                      json={"displayName": "Updated"}).status_code == 403
    assert client.get(ACCOUNT, headers=headers).json()["displayName"] == "Customer"


def test_profile_displays_and_updates_only_its_own_contact_details(client, sign_in):
    _, owner = sign_in(phone="+60100001120")
    other = signup(client, "other.customer")
    assert client.get(ACCOUNT, headers=owner).json()["phone"] == "+60100001120"
    assert client.get(ACCOUNT, headers=other).json()["phone"] == "+60000000003"
    updated = client.put(ACCOUNT, headers=owner, json={
        "displayName": "Updated", "phone": "+60100001121", "email": "customer@example.test",
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()["phone"] == "+60100001121"
    assert updated.json()["email"] == "customer@example.test"
    assert client.get(ACCOUNT, headers=other).json()["email"] is None
    _, login_headers = sign_in(phone="+60100001120")
    assert client.get(ACCOUNT, headers=login_headers).json()["phone"] == "+60100001121"
    cleared = client.put(ACCOUNT, headers=owner, json={"displayName": "Updated", "email": None})
    assert cleared.status_code == 200
    assert cleared.json()["email"] is None
    assert cleared.json()["phone"] == "+60100001121"


def test_username_can_change_again_at_sixty_days(client, clock):
    first = signup(client, "first.customer")
    signup(client, "other.customer")
    assert client.put(ACCOUNT, headers=first, json={
        "displayName": "Updated name", "username": "OTHER.CUSTOMER",
    }).json()["code"] == "USERNAME_UNAVAILABLE"
    changed = client.put(ACCOUNT, headers=first, json={"displayName": "Updated name", "username": "New.Customer"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["username"] == "new.customer"
    deadline = changed.json()["usernameChangeAvailableAt"]
    assert deadline == iso(clock.current + timedelta(days=60))
    locked = client.put(ACCOUNT, headers=first, json={"displayName": "Blocked", "username": "third.customer"})
    assert locked.status_code == 409 and locked.json()["code"] == "USERNAME_CHANGE_LOCKED"
    display_only = client.put(ACCOUNT, headers=first, json={"displayName": "Different name"})
    assert display_only.status_code == 200
    assert display_only.json()["usernameChangeAvailableAt"] == deadline
    assert login(client, "first.customer", PASSWORD).status_code == 401
    assert login(client, "NEW.CUSTOMER", PASSWORD).status_code == 200

    clock.advance(days=60)
    fresh = session_headers(login(client, "new.customer", PASSWORD))
    assert client.get(ACCOUNT, headers=fresh).json()["usernameChangeAvailableAt"] is None
    assert client.put(ACCOUNT, headers=fresh, json={"displayName": "Different name", "username": "third.customer"}).status_code == 200


def test_photo_is_normalized_and_private(client):
    owner = signup(client, "photo.owner")
    other = signup(client, "other.customer")
    image = BytesIO()
    Image.new("RGB", (512, 300), "red").save(image, "PNG")
    updated = client.put(ACCOUNT, headers=owner, json={
        "displayName": "Photo owner",
        "avatar": {"mediaType": "image/png", "data": b64encode(image.getvalue()).decode()},
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()["avatarVersion"]
    photo = client.get(ACCOUNT + "/photo", headers=owner)
    assert photo.headers["content-type"] == "image/webp"
    assert photo.headers["cache-control"] == "private, no-store"
    with Image.open(BytesIO(photo.content)) as thumbnail:
        assert thumbnail.size == (256, 256)
    assert client.get(ACCOUNT + "/photo", headers=other).status_code == 404
    assert client.put(ACCOUNT, headers=owner, json={
        "displayName": "Bad image", "avatar": {"mediaType": "image/png", "data": "bad"},
    }).status_code == 422
    assert client.get(ACCOUNT, headers=owner).json()["displayName"] == "Photo owner"
    assert client.put(ACCOUNT, headers=owner, json={"displayName": "Photo owner", "avatar": None}).status_code == 200
    assert client.get(ACCOUNT + "/photo", headers=owner).status_code == 404


def test_password_change_verifies_current_password_and_revokes_other_sessions(client):
    current = signup(client, "secure.customer")
    other = session_headers(login(client, "secure.customer", PASSWORD))
    password_path = ACCOUNT + "/password"
    body = {"currentPassword": "Wrong!", "newPassword": "Changed1!"}
    wrong = client.post(password_path, headers=current, json=body)
    assert wrong.status_code == 422 and wrong.json()["code"] == "CURRENT_PASSWORD_INCORRECT"
    assert client.get(ACCOUNT, headers=other).status_code == 200
    assert client.post(password_path, headers=current, json={**body, "currentPassword": PASSWORD}).status_code == 204
    assert client.get(ACCOUNT, headers=current).status_code == 200
    assert client.get(ACCOUNT, headers=other).status_code == 401
    assert login(client, "secure.customer", PASSWORD).status_code == 401
    assert login(client, "secure.customer", "Changed1!").status_code == 200


def test_legacy_phone_customer_can_edit_and_later_register(client, sign_in):
    phone = "+60100001120"
    existing, headers = sign_in(phone=phone)
    assert client.get(ACCOUNT, headers=headers).json()["username"] is None
    assert client.put(ACCOUNT, headers=headers, json={"displayName": "Existing customer"}).status_code == 200
    assert client.post(ACCOUNT + "/password", headers=headers,
                       json={"currentPassword": PASSWORD, "newPassword": "Changed1!"}).status_code == 403
    challenge = client.post(AUTH + "otp/challenges", headers=headers, json={"phone": phone, "intent": "signup"})
    verified = client.post(AUTH + "otp/verify", headers=headers, json={
        "intent": "signup", "challengeId": challenge.json()["challengeId"], "code": "123456",
        "registration": {"name": "Existing customer", "username": "legacy.customer", "password": PASSWORD},
    })
    assert verified.status_code == 200, verified.text
    assert verified.json()["accountId"] == existing["accountId"]
    assert client.get(ACCOUNT, headers=session_headers(verified)).json()["username"] == "legacy.customer"
