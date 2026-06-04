"""Provider adapter contract.

Each integration (GitHub, GitLab, Jira, Slack) implements this interface so the
OAuth flow and the ingestion pipeline stay provider-agnostic.
"""
from __future__ import annotations

import secrets
from urllib.parse import urlencode

from django.conf import settings


class ProviderError(Exception):
    pass


class IngestSink:
    """Interface the ingestion service passes to ``Provider.ingest``.

    Adapters call these to persist normalised data; they never touch the ORM.
    """

    def upsert_repository(self, *, external_id, name, **fields):  # -> repo handle
        raise NotImplementedError

    def upsert_contributor(self, *, external_id, username, **fields):  # -> contributor handle
        raise NotImplementedError

    def add_commit(self, *, repo, contributor, sha, **fields):
        raise NotImplementedError

    def add_issue(self, *, repo, contributor, external_id, **fields):
        raise NotImplementedError

    def log(self, message):
        raise NotImplementedError


class Provider:
    slug: str = ''
    name: str = ''
    # OAuth endpoints
    authorize_url_base: str = ''
    token_url: str = ''
    default_scopes: list[str] = []
    implemented: bool = False  # True once ingest() is real

    # ---- OAuth ----
    @classmethod
    def credentials(cls):
        creds = settings.INTEGRATION_OAUTH.get(cls.slug, {})
        return creds.get('client_id', ''), creds.get('client_secret', '')

    @classmethod
    def is_configured(cls):
        client_id, client_secret = cls.credentials()
        return bool(client_id and client_secret)

    @classmethod
    def redirect_uri(cls):
        return f"{settings.BACKEND_URL.rstrip('/')}/api/integrations/{cls.slug}/callback/"

    @classmethod
    def new_state(cls) -> str:
        return secrets.token_urlsafe(32)

    @classmethod
    def authorize_url(cls, state: str) -> str:
        client_id, _ = cls.credentials()
        params = {
            'client_id': client_id,
            'redirect_uri': cls.redirect_uri(),
            'scope': ' '.join(cls.default_scopes),
            'state': state,
            'response_type': 'code',
        }
        return f'{cls.authorize_url_base}?{urlencode(params)}'

    @classmethod
    def exchange_code(cls, code: str) -> dict:
        """Exchange an auth code for tokens + connected-account identity.

        Returns a dict with keys: access_token, refresh_token, expires_in,
        scope, account_login, account_id.
        """
        raise NotImplementedError

    # ---- Ingestion ----
    def ingest(self, connection, sink: IngestSink) -> None:
        raise NotImplementedError(
            f'Ingestion for {self.name} is not implemented yet.'
        )

    # ---- Repository discovery (for the in-app picker) ----
    def list_repositories(self, connection) -> list[dict]:
        """Return repos the connected account can access.

        Each item: {external_id, name, private, description, url, pushed_at}.
        """
        raise NotImplementedError(
            f'Repository listing for {self.name} is not implemented yet.'
        )
