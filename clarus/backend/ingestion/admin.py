from django.contrib import admin

from .models import IngestionRun


@admin.register(IngestionRun)
class IngestionRunAdmin(admin.ModelAdmin):
    list_display = ('organization', 'provider', 'status', 'created_at', 'finished_at')
    list_filter = ('provider', 'status')
    readonly_fields = ('log', 'stats', 'error')
