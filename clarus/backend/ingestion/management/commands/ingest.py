"""Run ingestion synchronously for an org + provider.

    python manage.py ingest --org acme --provider github
"""
from django.core.management.base import BaseCommand, CommandError

from accounts.models import Organization
from integrations.models import Connection

from ...models import IngestionRun
from ...services import run_ingestion


class Command(BaseCommand):
    help = 'Run ingestion for an organization and provider (synchronous).'

    def add_arguments(self, parser):
        parser.add_argument('--org', required=True, help='Organization slug')
        parser.add_argument('--provider', required=True)
        parser.add_argument('--no-profiles', action='store_true',
                            help='Skip AI profile generation')

    def handle(self, *args, **opts):
        try:
            org = Organization.objects.get(slug=opts['org'])
        except Organization.DoesNotExist:
            raise CommandError(f"No organization with slug '{opts['org']}'")
        conn = Connection.objects.filter(
            organization=org, provider=opts['provider'],
            status=Connection.Status.ACTIVE).first()
        if not conn:
            raise CommandError(f"No active {opts['provider']} connection for '{org.slug}'.")
        run = IngestionRun.objects.create(
            organization=org, connection=conn, provider=opts['provider'])
        self.stdout.write(f'Starting ingestion run {run.id} ...')
        run = run_ingestion(run, generate_profiles=not opts['no_profiles'])
        if run.status == IngestionRun.Status.SUCCESS:
            self.stdout.write(self.style.SUCCESS(f'Done. Stats: {run.stats}'))
        else:
            self.stdout.write(self.style.ERROR(f'Failed: {run.error}'))
