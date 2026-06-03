from rest_framework.generics import RetrieveAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import resolve_organization
from integrations.models import Connection

from .models import IngestionRun
from .serializers import IngestionRunSerializer
from .services import run_ingestion_async


class TriggerIngestionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, slug):
        org = resolve_organization(request)
        connection = Connection.objects.filter(
            organization=org, provider=slug, status=Connection.Status.ACTIVE
        ).first()
        if not connection:
            return Response({'detail': f'No active {slug} connection.'}, status=400)

        # Optionally update ingest targets (e.g. which orgs/repos) before running.
        targets = request.data.get('targets')
        if targets is not None:
            connection.metadata = {**(connection.metadata or {}), 'targets': targets}
            connection.save(update_fields=['metadata'])

        run = IngestionRun.objects.create(
            organization=org, connection=connection, provider=slug, created_by=request.user)
        run_ingestion_async(run)
        return Response(IngestionRunSerializer(run).data, status=202)


class IngestionRunListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        org = resolve_organization(request)
        runs = IngestionRun.objects.filter(organization=org)[:50]
        return Response(IngestionRunSerializer(runs, many=True).data)


class IngestionRunDetailView(RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = IngestionRunSerializer

    def get_queryset(self):
        return IngestionRun.objects.filter(organization=resolve_organization(self.request))
