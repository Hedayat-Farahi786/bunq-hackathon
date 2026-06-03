from django.urls import path

from .views import (
    CallbackView,
    ConnectionListView,
    ConnectView,
    DisconnectView,
    ProviderListView,
)

urlpatterns = [
    path('providers/', ProviderListView.as_view(), name='providers'),
    path('connections/', ConnectionListView.as_view(), name='connections'),
    path('<slug:slug>/connect/', ConnectView.as_view(), name='connect'),
    path('<slug:slug>/callback/', CallbackView.as_view(), name='callback'),
    path('<slug:slug>/', DisconnectView.as_view(), name='disconnect'),
]
