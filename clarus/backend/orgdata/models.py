"""Provider-agnostic, org-scoped domain data.

Everything here is owned by an Organization (tenant). Ingestion adapters for
GitHub / GitLab / Jira / Slack all normalise their data into these models so the
org lens, profiles and chat work the same regardless of source.
"""
from django.db import models

from accounts.models import Organization

PROVIDERS = (
    ('github', 'GitHub'),
    ('gitlab', 'GitLab'),
    ('jira', 'Jira'),
    ('slack', 'Slack'),
)


class Repository(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='repositories')
    provider = models.CharField(max_length=20, choices=PROVIDERS)
    external_id = models.CharField(max_length=255)
    name = models.CharField(max_length=512)
    url = models.URLField(blank=True)
    avatar_url = models.URLField(blank=True)
    description = models.TextField(blank=True)
    summary = models.TextField(blank=True)  # AI generated
    raw = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('organization', 'provider', 'external_id')

    def __str__(self):
        return self.name


class Contributor(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='contributors')
    provider = models.CharField(max_length=20, choices=PROVIDERS)
    external_id = models.CharField(max_length=255)
    username = models.CharField(max_length=255)
    display_name = models.CharField(max_length=255, blank=True)
    email = models.EmailField(blank=True)
    url = models.URLField(blank=True)
    avatar_url = models.URLField(blank=True)
    summary = models.TextField(blank=True)  # AI generated profile
    raw = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('organization', 'provider', 'external_id')

    def __str__(self):
        return self.username


class RepositoryWork(models.Model):
    """A contributor's body of work within one repository."""
    repository = models.ForeignKey(Repository, on_delete=models.CASCADE, related_name='works')
    contributor = models.ForeignKey(Contributor, on_delete=models.CASCADE, related_name='works')
    summary = models.TextField(blank=True)
    commit_count = models.IntegerField(default=0)
    issue_count = models.IntegerField(default=0)
    pr_count = models.IntegerField(default=0)

    class Meta:
        unique_together = ('repository', 'contributor')

    def __str__(self):
        return f'{self.contributor.username} -> {self.repository.name}'


class Commit(models.Model):
    work = models.ForeignKey(RepositoryWork, on_delete=models.CASCADE, related_name='commits')
    sha = models.CharField(max_length=128)
    url = models.URLField(blank=True)
    message = models.TextField(blank=True)
    summary = models.TextField(blank=True)
    additions = models.IntegerField(default=0)
    deletions = models.IntegerField(default=0)
    authored_at = models.DateTimeField(null=True, blank=True)
    raw = models.JSONField(default=dict, blank=True)


class Issue(models.Model):
    """Covers issues and pull/merge requests (and Jira issues)."""
    work = models.ForeignKey(RepositoryWork, on_delete=models.CASCADE, related_name='issues')
    external_id = models.CharField(max_length=255)
    url = models.URLField(blank=True)
    title = models.TextField(blank=True)
    state = models.CharField(max_length=50, blank=True)
    is_pull_request = models.BooleanField(default=False)
    summary = models.TextField(blank=True)
    created_at = models.DateTimeField(null=True, blank=True)
    raw = models.JSONField(default=dict, blank=True)
