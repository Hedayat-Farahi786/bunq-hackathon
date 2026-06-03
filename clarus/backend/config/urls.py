from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def health(_request):
    return JsonResponse({'status': 'ok', 'service': 'clarus-api'})


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', health, name='health'),
    path('api/auth/', include('accounts.urls')),
    path('api/integrations/', include('integrations.urls')),
    path('api/', include('orgdata.urls')),
    path('api/ingestion/', include('ingestion.urls')),
    path('api/insights/', include('insights.urls')),
]
