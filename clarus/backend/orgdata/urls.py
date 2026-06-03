from django.urls import path

from .views import (
    ContributorDetailView,
    ContributorListView,
    DataView,
    RepositoryListView,
)

urlpatterns = [
    path('data/', DataView.as_view(), name='data'),
    path('repositories/', RepositoryListView.as_view(), name='repositories'),
    path('contributors/', ContributorListView.as_view(), name='contributors'),
    path('contributors/<int:pk>/', ContributorDetailView.as_view(), name='contributor-detail'),
]
