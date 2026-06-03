"""Helpers for resolving the caller's active organization (tenant)."""
from rest_framework.exceptions import NotFound, PermissionDenied

from .models import Membership


def resolve_membership(request):
    """Return the Membership for the active org.

    The active org is chosen by the ``X-Org-Slug`` request header; if absent we
    fall back to the user's most recently created membership.
    """
    slug = request.headers.get('X-Org-Slug')
    qs = Membership.objects.filter(user=request.user).select_related('organization')
    if slug:
        membership = qs.filter(organization__slug=slug).first()
        if not membership:
            raise PermissionDenied('You are not a member of this organization.')
        return membership
    membership = qs.order_by('-created_at').first()
    if not membership:
        raise NotFound('You do not belong to any organization yet.')
    return membership


def resolve_organization(request):
    return resolve_membership(request).organization
