import uuid

from django.db import models

from accounts.models import Organization, User
from integrations.models import Connection
from orgdata.models import PROVIDERS


class IngestionRun(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        RUNNING = 'running', 'Running'
        SUCCESS = 'success', 'Success'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='runs')
    connection = models.ForeignKey(Connection, on_delete=models.SET_NULL, null=True, related_name='runs')
    provider = models.CharField(max_length=20, choices=PROVIDERS)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    stats = models.JSONField(default=dict, blank=True)
    log = models.TextField(blank=True)
    error = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ('-created_at',)

    def append_log(self, message):
        self.log = (self.log + message + '\n')[-20000:]
        self.save(update_fields=['log'])
