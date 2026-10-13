from getpass import getpass

from fastapi import HTTPException
from pydantic import ValidationError

from main import UserCreate, create_account, initialize_database


def main():
    username = input("Management username (letters, numbers, underscore): ")
    password = getpass("Password (at least 12 characters): ")
    confirmation = getpass("Confirm password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match. No account was created.")
    try:
        credentials = UserCreate(username=username, password=password)
    except ValidationError as error:
        messages = [f'{item["loc"][0]}: {item["msg"]}' for item in error.errors(include_input=False)]
        raise SystemExit("\n".join(messages)) from None
    initialize_database()
    try:
        user = create_account(credentials, role="management")
    except HTTPException as error:
        raise SystemExit(error.detail) from None
    print(f"Created management account: {user.username}")


if __name__ == "__main__":
    main()
