"""Jira (Atlassian 3LO) provider: OAuth implemented; ingestion scaffolded."""
from __future__ import annotations

from urllib.parse import urlencode

import requests

from .base import Provider, ProviderError


class JiraProvider(Provider):
    slug = 'jira'
    name = 'Jira'
    authorize_url_base = 'https://auth.atlassian.com/authorize'
    token_url = 'https://auth.atlassian.com/oauth/token'
    default_scopes = ['read:jira-work', 'read:jira-user', 'offline_access']
    implemented = False

    @classmethod
    def authorize_url(cls, state: str) -> str:
        client_id, _ = cls.credentials()
        params = {
            'audience': 'api.atlassian.com',
            'client_id': client_id,
            'scope': ' '.join(cls.default_scopes),
            'redirect_uri': cls.redirect_uri(),
            'state': state,
            'response_type': 'code',
            'prompt': 'consent',
        }
        return f'{cls.authorize_url_base}?{urlencode(params)}'

    @classmethod
    def exchange_code(cls, code: str) -> dict:
        client_id, client_secret = cls.credentials()
        resp = requests.post(cls.token_url, json={
            'grant_type': 'authorization_code',
            'client_id': client_id,
            'client_secret': client_secret,
            'code': code,
            'redirect_uri': cls.redirect_uri(),
        }, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        access_token = payload['access_token']
        # Resolve the accessible Jira Cloud site(s).
        resources = requests.get(
            'https://api.atlassian.com/oauth/token/accessible-resources',
            headers={'Authorization': f'Bearer {access_token}'}, timeout=30,
        ).json()
        site = resources[0] if resources else {}
        return {
            'access_token': access_token,
            'refresh_token': payload.get('refresh_token', ''),
            'expires_in': payload.get('expires_in'),
            'scope': payload.get('scope', ''),
            'account_login': site.get('name', ''),
            'account_id': site.get('id', ''),
            'metadata': {'cloud_id': site.get('id', ''), 'sites': resources},
        }

    def ingest(self, connection, sink) -> None:
        # TODO: use cloud_id -> https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3
        # Map projects -> Repository, assignees/reporters -> Contributor, issues -> Issue.
        raise NotImplementedError('Jira ingestion is scaffolded but not yet implemented.')
