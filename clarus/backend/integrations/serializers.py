from rest_framework import serializers

from .models import Connection


class ConnectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Connection
        fields = ('id', 'provider', 'status', 'account_login', 'account_id',
                  'scopes', 'metadata', 'created_at', 'updated_at')
