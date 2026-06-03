from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Membership, Organization
from .permissions import resolve_membership
from .serializers import OrganizationSerializer, RegisterSerializer, UserSerializer


def tokens_for(user):
    refresh = RefreshToken.for_user(user)
    return {'access': str(refresh.access_token), 'refresh': str(refresh)}


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {'user': UserSerializer(user).data, 'tokens': tokens_for(user)},
            status=status.HTTP_201_CREATED,
        )


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        memberships = (
            Membership.objects.filter(user=request.user)
            .select_related('organization')
            .order_by('-created_at')
        )
        orgs = []
        for m in memberships:
            org = m.organization
            org._membership = m
            orgs.append(org)
        active = resolve_membership(request)
        return Response({
            'user': UserSerializer(request.user).data,
            'organizations': OrganizationSerializer(orgs, many=True).data,
            'active_organization': active.organization.slug,
        })


class OrganizationListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        name = (request.data.get('name') or '').strip()
        if not name:
            return Response({'detail': 'name is required'}, status=400)
        org = Organization.objects.create(name=name, created_by=request.user)
        membership = Membership.objects.create(
            organization=org, user=request.user, role=Membership.Role.OWNER
        )
        org._membership = membership
        return Response(OrganizationSerializer(org).data, status=status.HTTP_201_CREATED)
