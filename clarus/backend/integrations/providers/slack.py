"""Slack provider: OAuth implemented; ingestion scaffolded."""
from __future__ import annotations

import requests

from .base import Provider, ProviderError


class SlackProvider(Provider):
    slug = 'slack'
    name = 'Slack'
    authorize_url_base = 'https://slack.com/oauth/v2/authorize'
    token_url = 'https://slack.com/api/oauth.v2.access'
    # Bot scopes for reading public channel activity + user directory.
    default_scopes = ['channels:history', 'channels:read', 'users:read']
    implemented = False

    @classmethod
    def exchange_code(cls, code: str) -> dict:
        client_id, client_secret = cls.credentials()
        resp = requests.post(cls.token_url, data={
            'client_id': client_id,
            'client_secret': client_secret,
            'code': code,
            'redirect_uri': cls.redirect_uri(),
        }, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        if not payload.get('ok'):
            raise ProviderError(payload.get('error', 'slack oauth failed'))
        team = payload.get('team', {})
        return {
            'access_token': payload.get('access_token', ''),  # bot token
            'refresh_token': payload.get('refresh_token', ''),
            'expires_in': payload.get('expires_in'),
            'scope': payload.get('scope', ''),
            'account_login': team.get('name', ''),
            'account_id': team.get('id', ''),
            'metadata': {'team': team, 'bot_user_id': payload.get('bot_user_id', '')},
        }

    def ingest(self, connection, sink) -> None:
        # TODO: conversations.list -> channels, conversations.history -> messages,
        # users.list -> Contributor. Derive expertise signals from message activity.
        raise NotImplementedError('Slack ingestion is scaffolded but not yet implemented.')
