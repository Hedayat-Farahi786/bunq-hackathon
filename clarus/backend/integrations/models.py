import uuid

from django.db import models

from accounts.models import Organization, User
from orgdata.models import PROVIDERS


class Connection(models.Model):
    """An OAuth (or token) connection between an Organization and a provider."""

    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        ERROR = 'error', 'Error'
        REVOKED = 'revoked', 'Revoked'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='connections')
    provider = models.CharField(max_length=20, choices=PROVIDERS)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)

    # Credentials. NOTE: encrypt at rest in production (e.g. django-fernet-fields / KMS).
    access_token = models.TextField(blank=True)
    refresh_token = models.TextField(blank=True)
    token_expires_at = models.DateTimeField(null=True, blank=True)
    scopes = models.CharField(max_length=512, blank=True)

    # Identity of the connected account on the provider side.
    account_login = models.CharField(max_length=255, blank=True)
    account_id = models.CharField(max_length=255, blank=True)
    # Provider-specific config (e.g. Jira cloud id, Slack team id, selected repos).
    metadata = models.JSONField(default=dict, blank=True)

    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='connections')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('organization', 'provider')

    def __str__(self):
        return f'{self.organization.slug}:{self.provider} ({self.status})'


class OAuthState(models.Model):
    """Short-lived anti-CSRF state for an in-flight OAuth authorization."""
    state = models.CharField(max_length=64, unique=True)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE)
    provider = models.CharField(max_length=20, choices=PROVIDERS)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
