from django.contrib import admin

from .models import Connection, OAuthState


@admin.register(Connection)
class ConnectionAdmin(admin.ModelAdmin):
    list_display = ('organization', 'provider', 'status', 'account_login', 'updated_at')
    list_filter = ('provider', 'status')


admin.site.register(OAuthState)
