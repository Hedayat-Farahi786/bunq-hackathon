"""Ingestion orchestration.

A provider adapter streams normalised records into a :class:`DBSink`, which
persists them as org-scoped :mod:`orgdata` rows. After a successful run we kick
off AI profile generation.

For a production SaaS this should run on a task queue (Celery/RQ). We expose
``run_ingestion`` (synchronous, used by the management command and tests) and
``run_ingestion_async`` (a daemon thread) so the API can return immediately.
"""
from __future__ import annotations

import threading
import traceback

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from integrations.providers import IngestSink, get_provider
from orgdata.models import Commit, Contributor, Issue, Repository, RepositoryWork

from .models import IngestionRun


class DBSink(IngestSink):
    def __init__(self, run: IngestionRun):
        self.run = run
        self.org = run.organization
        self.provider = run.provider
        self.counts = {'repositories': 0, 'contributors': 0, 'commits': 0, 'issues': 0}
        self._work_cache: dict[tuple[int, int], RepositoryWork] = {}

    def upsert_repository(self, *, external_id, name, **fields):
        repo, created = Repository.objects.update_or_create(
            organization=self.org, provider=self.provider, external_id=str(external_id),
            defaults={'name': name, **{k: v for k, v in fields.items() if v is not None}},
        )
        if created:
            self.counts['repositories'] += 1
        return repo

    def upsert_contributor(self, *, external_id, username, **fields):
        contributor, created = Contributor.objects.update_or_create(
            organization=self.org, provider=self.provider, external_id=str(external_id),
            defaults={'username': username, **{k: v for k, v in fields.items() if v is not None}},
        )
        if created:
            self.counts['contributors'] += 1
        return contributor

    def ensure_work(self, repo, contributor):
        key = (repo.id, contributor.id)
        if key not in self._work_cache:
            self._work_cache[key] = RepositoryWork.objects.get_or_create(
                repository=repo, contributor=contributor)[0]
        return self._work_cache[key]

    def add_commit(self, *, repo, contributor, sha, **fields):
        work = self.ensure_work(repo, contributor)
        authored_at = fields.pop('authored_at', None)
        if isinstance(authored_at, str):
            authored_at = parse_datetime(authored_at)
        _, created = Commit.objects.update_or_create(
            work=work, sha=sha,
            defaults={'authored_at': authored_at, **fields},
        )
        if created:
            self.counts['commits'] += 1

    def add_issue(self, *, repo, contributor, external_id, **fields):
        work = self.ensure_work(repo, contributor)
        created_at = fields.pop('created_at', None)
        if isinstance(created_at, str):
            created_at = parse_datetime(created_at)
        _, created = Issue.objects.update_or_create(
            work=work, external_id=str(external_id),
            defaults={'created_at': created_at, **fields},
        )
        if created:
            self.counts['issues'] += 1

    def log(self, message):
        self.run.append_log(message)


def _recompute_work_counts(org):
    from django.db.models import Count, Q
    for work in RepositoryWork.objects.filter(repository__organization=org).annotate(
        c=Count('commits', distinct=True),
        i=Count('issues', filter=Q(issues__is_pull_request=False), distinct=True),
        p=Count('issues', filter=Q(issues__is_pull_request=True), distinct=True),
    ):
        RepositoryWork.objects.filter(pk=work.pk).update(
            commit_count=work.c, issue_count=work.i, pr_count=work.p)


def run_ingestion(run: IngestionRun, generate_profiles: bool = True):
    run.status = IngestionRun.Status.RUNNING
    run.started_at = timezone.now()
    run.save(update_fields=['status', 'started_at'])
    sink = DBSink(run)
    try:
        provider = get_provider(run.provider)
        provider.ingest(run.connection, sink)
        _recompute_work_counts(run.organization)
        run.stats = sink.counts
        run.append_log(f'Ingestion complete: {sink.counts}')

        if generate_profiles:
            try:
                from insights.services import generate_org_profiles
                run.append_log('Generating AI profiles ...')
                summary = generate_org_profiles(run.organization)
                run.stats['profiles'] = summary
                run.append_log(f'Profiles generated: {summary}')
            except Exception as e:  # noqa: BLE001 - profiles are best-effort
                run.append_log(f'Profile generation skipped/failed: {e}')

        run.status = IngestionRun.Status.SUCCESS
    except Exception as e:  # noqa: BLE001
        run.status = IngestionRun.Status.FAILED
        run.error = f'{e}\n{traceback.format_exc()}'
        run.append_log(f'ERROR: {e}')
    finally:
        run.finished_at = timezone.now()
        run.save()
    return run


def run_ingestion_async(run: IngestionRun):
    thread = threading.Thread(target=run_ingestion, args=(run,), daemon=True)
    thread.start()
    return run
