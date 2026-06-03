from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Membership, Organization

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'email', 'full_name', 'date_joined')


class OrganizationSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = ('id', 'name', 'slug', 'created_at', 'role')

    def get_role(self, obj):
        membership = getattr(obj, '_membership', None)
        return membership.role if membership else None


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    full_name = serializers.CharField(required=False, allow_blank=True)
    organization_name = serializers.CharField(required=False, allow_blank=True)

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return value.lower()

    def create(self, validated):
        user = User.objects.create_user(
            email=validated['email'],
            password=validated['password'],
            full_name=validated.get('full_name', ''),
        )
        org_name = validated.get('organization_name') or f"{user.email.split('@')[0]}'s org"
        org = Organization.objects.create(name=org_name, created_by=user)
        Membership.objects.create(organization=org, user=user, role=Membership.Role.OWNER)
        return user
