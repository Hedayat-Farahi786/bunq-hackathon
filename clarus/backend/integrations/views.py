from datetime import timedelta

from django.shortcuts import redirect
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import resolve_organization

from .models import Connection, OAuthState
from .providers import ProviderError, all_providers, get_provider_class
from .serializers import ConnectionSerializer


class ProviderListView(APIView):
    """List every provider with its config + connection status for this org."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        org = resolve_organization(request)
        connections = {c.provider: c for c in Connection.objects.filter(organization=org)}
        data = []
        for p in all_providers():
            conn = connections.get(p.slug)
            data.append({
                'slug': p.slug,
                'name': p.name,
                'configured': p.is_configured(),       # OAuth app creds present
                'ingestion_ready': p.implemented,       # ingest() implemented
                'connected': bool(conn),
                'status': conn.status if conn else None,
                'account_login': conn.account_login if conn else None,
                'scopes': p.default_scopes,
            })
        return Response(data)


class ConnectView(APIView):
    """Begin OAuth: returns the provider authorize URL for the SPA to redirect to."""
    permission_classes = [IsAuthenticated]

    def post(self, request, slug):
        org = resolve_organization(request)
        try:
            provider_cls = get_provider_class(slug)
        except ProviderError as e:
            return Response({'detail': str(e)}, status=404)
        if not provider_cls.is_configured():
            return Response(
                {'detail': f'{provider_cls.name} OAuth app is not configured on the server '
                           f'(set {slug.upper()}_CLIENT_ID / _SECRET).'},
                status=400,
            )
        state = provider_cls.new_state()
        OAuthState.objects.create(state=state, organization=org, provider=slug, user=request.user)
        # Optionally remember ingest targets chosen in the UI.
        targets = request.data.get('targets')
        if targets is not None:
            conn, _ = Connection.objects.get_or_create(
                organization=org, provider=slug,
                defaults={'created_by': request.user, 'status': Connection.Status.REVOKED},
            )
            conn.metadata = {**(conn.metadata or {}), 'targets': targets}
            conn.save(update_fields=['metadata'])
        return Response({'authorize_url': provider_cls.authorize_url(state)})


class CallbackView(APIView):
    """OAuth redirect target. Hit by the provider via the browser (no JWT)."""
    permission_classes = [AllowAny]

    def get(self, request, slug):
        code = request.GET.get('code')
        state = request.GET.get('state')
        from django.conf import settings
        front = settings.FRONTEND_URL.rstrip('/')
        if not code or not state:
            return redirect(f'{front}/integrations?error=missing_code')
        oauth_state = OAuthState.objects.filter(state=state, provider=slug).first()
        if not oauth_state:
            return redirect(f'{front}/integrations?error=invalid_state')
        org, user = oauth_state.organization, oauth_state.user
        oauth_state.delete()
        try:
            provider_cls = get_provider_class(slug)
            result = provider_cls.exchange_code(code)
        except Exception as e:  # noqa: BLE001 - surface any failure to the UI
            return redirect(f'{front}/integrations?error=exchange_failed&provider={slug}')

        expires_at = None
        if result.get('expires_in'):
            expires_at = timezone.now() + timedelta(seconds=int(result['expires_in']))
        conn, _ = Connection.objects.get_or_create(
            organization=org, provider=slug, defaults={'created_by': user})
        conn.access_token = result.get('access_token', '')
        conn.refresh_token = result.get('refresh_token', '')
        conn.token_expires_at = expires_at
        conn.scopes = result.get('scope', '')
        conn.account_login = result.get('account_login', '')
        conn.account_id = result.get('account_id', '')
        conn.status = Connection.Status.ACTIVE
        if result.get('metadata'):
            conn.metadata = {**(conn.metadata or {}), **result['metadata']}
        if not conn.created_by:
            conn.created_by = user
        conn.save()
        return redirect(f'{front}/integrations?connected={slug}')


class DisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, slug):
        org = resolve_organization(request)
        Connection.objects.filter(organization=org, provider=slug).delete()
        return Response(status=204)


class ConnectionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        org = resolve_organization(request)
        conns = Connection.objects.filter(organization=org)
        return Response(ConnectionSerializer(conns, many=True).data)
