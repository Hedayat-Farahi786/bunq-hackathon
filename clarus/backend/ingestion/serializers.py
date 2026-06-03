from rest_framework import serializers

from .models import IngestionRun


class IngestionRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = IngestionRun
        fields = ('id', 'provider', 'status', 'stats', 'error', 'log',
                  'created_at', 'started_at', 'finished_at')
