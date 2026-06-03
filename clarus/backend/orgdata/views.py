from rest_framework.generics import RetrieveAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import resolve_organization

from .models import Contributor, Repository
from .serializers import (
    ContributorListSerializer,
    ContributorSerializer,
    RepositorySerializer,
)


class OrgScopedMixin:
    permission_classes = [IsAuthenticated]

    def get_organization(self):
        return resolve_organization(self.request)


class DataView(OrgScopedMixin, APIView):
    """The full org lens payload: repositories + contributors (with works)."""

    def get(self, request):
        org = self.get_organization()
        repositories = Repository.objects.filter(organization=org)
        contributors = (
            Contributor.objects.filter(organization=org)
            .prefetch_related('works', 'works__commits', 'works__issues', 'works__repository')
        )
        return Response({
            'repositories': RepositorySerializer(repositories, many=True).data,
            'contributors': ContributorSerializer(contributors, many=True).data,
        })


class RepositoryListView(OrgScopedMixin, APIView):
    def get(self, request):
        org = self.get_organization()
        repos = Repository.objects.filter(organization=org)
        return Response(RepositorySerializer(repos, many=True).data)


class ContributorListView(OrgScopedMixin, APIView):
    def get(self, request):
        org = self.get_organization()
        contributors = Contributor.objects.filter(organization=org)
        return Response(ContributorListSerializer(contributors, many=True).data)


class ContributorDetailView(OrgScopedMixin, RetrieveAPIView):
    serializer_class = ContributorSerializer

    def get_queryset(self):
        return Contributor.objects.filter(organization=self.get_organization()).prefetch_related(
            'works', 'works__commits', 'works__issues', 'works__repository'
        )
