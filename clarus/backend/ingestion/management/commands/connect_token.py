"""Create/update a provider Connection from a raw access token (PAT).

Handy for local testing without registering an OAuth app, e.g.:

    python manage.py connect_token --org acme --provider github \
        --token ghp_xxx --login octocat --targets meta-llama/llama-models
"""
from django.core.management.base import BaseCommand, CommandError

from accounts.models import Organization
from integrations.models import Connection


class Command(BaseCommand):
    help = 'Create or update an integration Connection from a raw access token.'

    def add_arguments(self, parser):
        parser.add_argument('--org', required=True, help='Organization slug')
        parser.add_argument('--provider', required=True)
        parser.add_argument('--token', required=True)
        parser.add_argument('--login', default='', help='Account login on the provider')
        parser.add_argument('--targets', nargs='*', default=None,
                            help='owner or owner/repo targets to ingest')

    def handle(self, *args, **opts):
        try:
            org = Organization.objects.get(slug=opts['org'])
        except Organization.DoesNotExist:
            raise CommandError(f"No organization with slug '{opts['org']}'")
        conn, _ = Connection.objects.get_or_create(organization=org, provider=opts['provider'])
        conn.access_token = opts['token']
        conn.account_login = opts['login']
        conn.status = Connection.Status.ACTIVE
        if opts['targets'] is not None:
            conn.metadata = {**(conn.metadata or {}), 'targets': opts['targets']}
        conn.save()
        self.stdout.write(self.style.SUCCESS(
            f"Connected {opts['provider']} for org '{org.slug}'."))
