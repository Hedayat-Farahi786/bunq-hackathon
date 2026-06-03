from django.urls import path

from .views import (
    IngestionRunDetailView,
    IngestionRunListView,
    TriggerIngestionView,
)

urlpatterns = [
    path('runs/', IngestionRunListView.as_view(), name='runs'),
    path('runs/<uuid:pk>/', IngestionRunDetailView.as_view(), name='run-detail'),
    path('<slug:slug>/run/', TriggerIngestionView.as_view(), name='trigger'),
]
