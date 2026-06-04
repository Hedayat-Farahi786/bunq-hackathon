"""GitLab provider: OAuth + ingestion of projects, members, commits, issues, MRs."""
from __future__ import annotations

from urllib.parse import quote

import requests

from .base import Provider, ProviderError

API = 'https://gitlab.com/api/v4'

MAX_PROJECTS = 25
MAX_MEMBERS_PER_PROJECT = 40
MAX_COMMITS_PER_PROJECT = 100
MAX_ISSUES_PER_PROJECT = 50
MAX_MRS_PER_PROJECT = 50


class GitLabProvider(Provider):
    slug = 'gitlab'
    name = 'GitLab'
    authorize_url_base = 'https://gitlab.com/oauth/authorize'
    token_url = 'https://gitlab.com/oauth/token'
    default_scopes = ['read_api', 'read_user', 'read_repository']
    implemented = True

    # ---- OAuth ----
    @classmethod
    def exchange_code(cls, code: str) -> dict:
        client_id, client_secret = cls.credentials()
        resp = requests.post(cls.token_url, data={
            'client_id': client_id,
            'client_secret': client_secret,
            'code': code,
            'grant_type': 'authorization_code',
            'redirect_uri': cls.redirect_uri(),
        }, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        access_token = payload['access_token']
        identity = requests.get(
            f'{API}/user', headers={'Authorization': f'Bearer {access_token}'}, timeout=30
        ).json()
        return {
            'access_token': access_token,
            'refresh_token': payload.get('refresh_token', ''),
            'expires_in': payload.get('expires_in'),
            'scope': payload.get('scope', ''),
            'account_login': identity.get('username', ''),
            'account_id': str(identity.get('id', '')),
        }

    # ---- Repository discovery ----
    def list_repositories(self, connection) -> list[dict]:
        token = connection.access_token
        if not token:
            raise ProviderError('GitLab connection has no access token.')
        headers = {'Authorization': f'Bearer {token}'}
        projects = self._paginate(
            f'{API}/projects', headers,
            params={'membership': 'true', 'order_by': 'last_activity_at'}, limit=300)
        return [{
            'external_id': str(p['id']),
            'name': p.get('path_with_namespace', p.get('name', '')),
            'private': p.get('visibility', 'private') != 'public',
            'description': p.get('description') or '',
            'url': p.get('web_url', ''),
            'pushed_at': p.get('last_activity_at'),
        } for p in projects]

    # ---- Ingestion ----
    def ingest(self, connection, sink) -> None:
        token = connection.access_token
        if not token:
            raise ProviderError('GitLab connection has no access token.')
        headers = {'Authorization': f'Bearer {token}'}
        targets = connection.metadata.get('targets') or []
        projects = self._resolve_projects(headers, targets)
        sink.log(f'Found {len(projects)} projects to ingest.')

        for proj in projects[:MAX_PROJECTS]:
            pid = proj['id']
            repo = sink.upsert_repository(
                external_id=str(pid),
                name=proj.get('path_with_namespace', proj.get('name', str(pid))),
                url=proj.get('web_url', ''),
                avatar_url=proj.get('avatar_url') or '',
                description=proj.get('description') or '',
                raw=proj,
            )
            sink.log(f"Ingesting {proj.get('path_with_namespace')} ...")
            self._ingest_members(headers, pid, repo, sink)
            self._ingest_commits(headers, pid, repo, sink)
            self._ingest_issues(headers, pid, repo, sink)
            self._ingest_merge_requests(headers, pid, repo, sink)

    # ---- helpers ----
    @staticmethod
    def _paginate(url, headers, params=None, limit=100):
        params = dict(params or {})
        params.setdefault('per_page', 100)
        items, page = [], 1
        while len(items) < limit:
            params['page'] = page
            resp = requests.get(url, headers=headers, params=params, timeout=30)
            if resp.status_code == 404:
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

    def _resolve_projects(self, headers, targets):
        if not targets:
            return self._paginate(f'{API}/projects', headers,
                                  params={'membership': 'true', 'order_by': 'last_activity_at'},
                                  limit=MAX_PROJECTS)
        projects = []
        for target in targets:
            if '/' in target:  # a project path: group/subgroup/project
                enc = quote(target, safe='')
                resp = requests.get(f'{API}/projects/{enc}', headers=headers, timeout=30)
                if resp.ok:
                    projects.append(resp.json())
            else:  # a group
                enc = quote(target, safe='')
                projects.extend(self._paginate(
                    f'{API}/groups/{enc}/projects', headers,
                    params={'include_subgroups': 'true', 'order_by': 'last_activity_at'},
                    limit=MAX_PROJECTS))
        return projects

    def _member_contributor(self, sink, user):
        return sink.upsert_contributor(
            external_id=str(user['id']),
            username=user.get('username', user.get('name', 'unknown')),
            display_name=user.get('name', ''),
            url=user.get('web_url', ''),
            avatar_url=user.get('avatar_url') or '',
            raw=user,
        )

    def _ingest_members(self, headers, pid, repo, sink):
        for user in self._paginate(f'{API}/projects/{pid}/members/all', headers,
                                   limit=MAX_MEMBERS_PER_PROJECT):
            contributor = self._member_contributor(sink, user)
            sink.ensure_work(repo, contributor)

    def _ingest_commits(self, headers, pid, repo, sink):
        for commit in self._paginate(f'{API}/projects/{pid}/repository/commits', headers,
                                     limit=MAX_COMMITS_PER_PROJECT):
            # GitLab commits expose author_name/email but not a user id; key by email.
            email = commit.get('author_email') or commit.get('author_name') or 'unknown'
            contributor = sink.upsert_contributor(
                external_id=f'email:{email}',
                username=commit.get('author_name', email),
                email=commit.get('author_email', ''),
                raw={'author_name': commit.get('author_name')},
            )
            sink.add_commit(
                repo=repo,
                contributor=contributor,
                sha=commit['id'],
                url=commit.get('web_url', ''),
                message=(commit.get('title') or '')[:1000],
                authored_at=commit.get('authored_date') or commit.get('created_at'),
                raw={'id': commit['id'], 'title': commit.get('title', '')},
            )

    def _ingest_issues(self, headers, pid, repo, sink):
        for issue in self._paginate(f'{API}/projects/{pid}/issues', headers,
                                    params={'scope': 'all'}, limit=MAX_ISSUES_PER_PROJECT):
            author = issue.get('author') or {}
            if not author.get('id'):
                continue
            contributor = self._member_contributor(sink, author)
            sink.add_issue(
                repo=repo, contributor=contributor,
                external_id=str(issue['iid']),
                url=issue.get('web_url', ''),
                title=(issue.get('title') or '')[:1000],
                state=issue.get('state', ''),
                is_pull_request=False,
                created_at=issue.get('created_at'),
                raw={'iid': issue['iid'], 'title': issue.get('title', '')},
            )

    def _ingest_merge_requests(self, headers, pid, repo, sink):
        for mr in self._paginate(f'{API}/projects/{pid}/merge_requests', headers,
                                 params={'scope': 'all', 'state': 'all'}, limit=MAX_MRS_PER_PROJECT):
            author = mr.get('author') or {}
            if not author.get('id'):
                continue
            contributor = self._member_contributor(sink, author)
            sink.add_issue(
                repo=repo, contributor=contributor,
                external_id=f"mr-{mr['iid']}",
                url=mr.get('web_url', ''),
                title=(mr.get('title') or '')[:1000],
                state=mr.get('state', ''),
                is_pull_request=True,
                created_at=mr.get('created_at'),
                raw={'iid': mr['iid'], 'title': mr.get('title', '')},
            )
