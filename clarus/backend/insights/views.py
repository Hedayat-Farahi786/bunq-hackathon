from django.http import StreamingHttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import resolve_organization
from orgdata.models import Contributor

from .services import generate_org_profiles, stream_chat, stream_twin_chat


class ChatView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        org = resolve_organization(request)
        question = (request.data.get('prompt') or '').strip()
        if not question:
            return Response({'detail': "Missing 'prompt'."}, status=400)
        response = StreamingHttpResponse(
            stream_chat(org, question),
            content_type='text/plain; charset=utf-8',
        )
        response['X-Accel-Buffering'] = 'no'
        return response


class TwinChatView(APIView):
    """Chat with a contributor's digital twin (grounded in their work)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        org = resolve_organization(request)
        contributor = (Contributor.objects
                       .filter(organization=org, pk=pk)
                       .prefetch_related('works', 'works__commits', 'works__issues', 'works__repository')
                       .first())
        if not contributor:
            return Response({'detail': 'Contributor not found.'}, status=404)
        question = (request.data.get('prompt') or '').strip()
        if not question:
            return Response({'detail': "Missing 'prompt'."}, status=400)
        response = StreamingHttpResponse(
            stream_twin_chat(contributor, question),
            content_type='text/plain; charset=utf-8',
        )
        response['X-Accel-Buffering'] = 'no'
        return response


class GenerateProfilesView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        org = resolve_organization(request)
        try:
            summary = generate_org_profiles(org)
        except RuntimeError as e:
            return Response({'detail': str(e)}, status=400)
        return Response(summary)
