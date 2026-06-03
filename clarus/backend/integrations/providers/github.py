"""GitHub provider: OAuth + ingestion of repos, contributors, commits, issues/PRs."""
from __future__ import annotations

import requests

from .base import Provider, ProviderError

API = 'https://api.github.com'

# Bounds so an ingest run stays responsive. Tunable per connection via metadata.
MAX_REPOS = 25
MAX_CONTRIBUTORS_PER_REPO = 30
MAX_COMMITS_PER_REPO = 100
MAX_ISSUES_PER_REPO = 60


class GitHubProvider(Provider):
    slug = 'github'
    name = 'GitHub'
    authorize_url_base = 'https://github.com/login/oauth/authorize'
    token_url = 'https://github.com/login/oauth/access_token'
    default_scopes = ['read:user', 'repo', 'read:org']
    implemented = True

    # ---- OAuth ----
    @classmethod
    def exchange_code(cls, code: str) -> dict:
        client_id, client_secret = cls.credentials()
        resp = requests.post(
            cls.token_url,
            headers={'Accept': 'application/json'},
            data={
                'client_id': client_id,
                'client_secret': client_secret,
                'code': code,
                'redirect_uri': cls.redirect_uri(),
            },
            timeout=30,
        )
        resp.raise_for_status()
        payload = resp.json()
        if 'error' in payload:
            raise ProviderError(payload.get('error_description', payload['error']))
        access_token = payload['access_token']
        identity = requests.get(
            f'{API}/user', headers=cls._headers(access_token), timeout=30
        ).json()
        return {
            'access_token': access_token,
            'refresh_token': payload.get('refresh_token', ''),
            'expires_in': payload.get('expires_in'),
            'scope': payload.get('scope', ''),
            'account_login': identity.get('login', ''),
            'account_id': str(identity.get('id', '')),
        }

    # ---- Ingestion ----
    def ingest(self, connection, sink) -> None:
        token = connection.access_token
        if not token:
            raise ProviderError('GitHub connection has no access token.')
        headers = self._headers(token)
        targets = connection.metadata.get('targets') or []
        repos = self._resolve_repos(headers, targets, connection.account_login)
        sink.log(f'Found {len(repos)} repositories to ingest.')

        for repo_json in repos[:MAX_REPOS]:
            full = repo_json['full_name']
            repo = sink.upsert_repository(
                external_id=str(repo_json['id']),
                name=full,
                url=repo_json.get('html_url', ''),
                avatar_url=(repo_json.get('owner') or {}).get('avatar_url', ''),
                description=repo_json.get('description') or '',
                raw=repo_json,
            )
            sink.log(f'Ingesting {full} ...')
            self._ingest_contributors(headers, full, repo, sink)
            self._ingest_commits(headers, full, repo, sink)
            self._ingest_issues(headers, full, repo, sink)

    # ---- helpers ----
    @staticmethod
    def _headers(token):
        return {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        }

    @staticmethod
    def _paginate(url, headers, params=None, limit=100):
        params = dict(params or {})
        params.setdefault('per_page', 100)
        items, page = [], 1
        while len(items) < limit:
            params['page'] = page
            resp = requests.get(url, headers=headers, params=params, timeout=30)
            if resp.status_code == 409:  # empty repo
                break
            resp.raise_for_status()
            batch = resp.json()
            if not isinstance(batch, list) or not batch:
                break
            items.extend(batch)
            if len(batch) < params['per_page']:
                break
            page += 1
        return items[:limit]

    def _resolve_repos(self, headers, targets, account_login):
        """Targets may be 'owner' (user/org) or 'owner/repo'. Default: viewer repos."""
        repos = []
        if not targets:
            return self._paginate(
                f'{API}/user/repos', headers,
                params={'affiliation': 'owner,organization,collaborator', 'sort': 'pushed'},
                limit=MAX_REPOS,
            )
        for target in targets:
            if '/' in target:
                resp = requests.get(f'{API}/repos/{target}', headers=headers, timeout=30)
                if resp.ok:
                    repos.append(resp.json())
                continue
            # try org then user
            org_repos = self._paginate(
                f'{API}/orgs/{target}/repos', headers, params={'sort': 'pushed'}, limit=MAX_REPOS)
            if org_repos:
                repos.extend(org_repos)
            else:
                repos.extend(self._paginate(
                    f'{API}/users/{target}/repos', headers, params={'sort': 'pushed'}, limit=MAX_REPOS))
        return repos

    def _ingest_contributors(self, headers, full, repo, sink):
        for c in self._paginate(f'{API}/repos/{full}/contributors', headers,
                                limit=MAX_CONTRIBUTORS_PER_REPO):
            if c.get('type') == 'Bot':
                continue
            contributor = sink.upsert_contributor(
                external_id=str(c['id']),
                username=c['login'],
                url=c.get('html_url', ''),
                avatar_url=c.get('avatar_url', ''),
                raw=c,
            )
            sink.ensure_work(repo, contributor)

    def _ingest_commits(self, headers, full, repo, sink):
        for commit in self._paginate(f'{API}/repos/{full}/commits', headers,
                                     limit=MAX_COMMITS_PER_REPO):
            author = commit.get('author') or {}
            login = author.get('login')
            if not login:
                continue
            contributor = sink.upsert_contributor(
                external_id=str(author['id']),
                username=login,
                url=author.get('html_url', ''),
                avatar_url=author.get('avatar_url', ''),
                raw=author,
            )
            data = commit.get('commit', {})
            sink.add_commit(
                repo=repo,
                contributor=contributor,
                sha=commit['sha'],
                url=commit.get('html_url', ''),
                message=(data.get('message') or '').split('\n')[0][:1000],
                authored_at=(data.get('author') or {}).get('date'),
                raw={'sha': commit['sha'], 'message': data.get('message', '')},
            )

    def _ingest_issues(self, headers, full, repo, sink):
        for issue in self._paginate(f'{API}/repos/{full}/issues', headers,
                                    params={'state': 'all'}, limit=MAX_ISSUES_PER_REPO):
            user = issue.get('user') or {}
            login = user.get('login')
            if not login:
                continue
            contributor = sink.upsert_contributor(
                external_id=str(user['id']),
                username=login,
                url=user.get('html_url', ''),
                avatar_url=user.get('avatar_url', ''),
                raw=user,
            )
            sink.add_issue(
                repo=repo,
                contributor=contributor,
                external_id=str(issue['number']),
                url=issue.get('html_url', ''),
                title=issue.get('title', '')[:1000],
                state=issue.get('state', ''),
                is_pull_request='pull_request' in issue,
                created_at=issue.get('created_at'),
                raw={'number': issue['number'], 'title': issue.get('title', '')},
            )
