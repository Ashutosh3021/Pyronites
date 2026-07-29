"""
Transactional email via Brevo (Sendinblue) free-tier API.

Env:
  BREVO_API_KEY          — required to actually send
  BREVO_SENDER_EMAIL     — verified sender (required when key is set)
  BREVO_SENDER_NAME      — optional display name (default: PyroCore)
  PASSWORD_RESET_BASE_URL — frontend origin for reset links, e.g. https://app.vercel.app
  PASSWORD_RESET_DEV_LOG  — if true/1, log the reset URL when email is skipped (local only)
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

BREVO_API = "https://api.brevo.com/v3/smtp/email"


def _sender() -> tuple[str, str]:
    email = (os.environ.get("BREVO_SENDER_EMAIL") or "").strip()
    name = (os.environ.get("BREVO_SENDER_NAME") or "PyroCore").strip()
    return email, name


def _reset_base_url() -> str:
    return (os.environ.get("PASSWORD_RESET_BASE_URL") or "").strip().rstrip("/")


def build_reset_link(raw_token: str) -> str:
    base = _reset_base_url()
    if not base:
        # Fallback for local dashboard
        base = "http://localhost:3000"
    return f"{base}/reset-password?token={raw_token}"


def send_password_reset_email(to_email: str, raw_token: str) -> bool:
    """
    Send a password-reset email.

    Returns:
        True if Brevo accepted the message, False if skipped or failed.
        Callers must not reveal this to the end user.
    """
    link = build_reset_link(raw_token)
    api_key = (os.environ.get("BREVO_API_KEY") or "").strip()
    sender_email, sender_name = _sender()

    if not api_key or not sender_email:
        logger.warning(
            "Password reset email not sent: BREVO_API_KEY or BREVO_SENDER_EMAIL unset"
        )
        if os.environ.get("PASSWORD_RESET_DEV_LOG", "").strip().lower() in (
            "1",
            "true",
            "yes",
            "on",
        ):
            # Local/dev only — never enable on production
            logger.info("DEV password reset link for %s: %s", to_email, link)
        return False

    html = f"""\
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
  <p>We received a request to reset your PyroCore password.</p>
  <p><a href="{link}" style="color: #e85d04;">Reset your password</a></p>
  <p style="font-size: 13px; color: #666;">This link expires in about one hour.
  If you did not request a reset, you can ignore this email.</p>
  <p style="font-size: 12px; color: #999; word-break: break-all;">{link}</p>
</body>
</html>
"""
    text = (
        "We received a request to reset your PyroCore password.\n\n"
        f"Open this link to choose a new password:\n{link}\n\n"
        "This link expires in about one hour. "
        "If you did not request a reset, ignore this email.\n"
    )

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": to_email}],
        "subject": "Reset your PyroCore password",
        "htmlContent": html,
        "textContent": text,
    }

    try:
        with httpx.Client(timeout=20.0) as client:
            res = client.post(
                BREVO_API,
                headers={
                    "api-key": api_key,
                    "accept": "application/json",
                    "content-type": "application/json",
                },
                json=payload,
            )
        if res.status_code >= 400:
            logger.error(
                "Brevo send failed status=%s body=%s",
                res.status_code,
                res.text[:500],
            )
            return False
        logger.info("Password reset email accepted by Brevo for recipient domain")
        return True
    except Exception:
        logger.error("Brevo send raised", exc_info=True)
        return False
