from django.urls import path

from .views import ChatView, GenerateProfilesView

urlpatterns = [
    path('chat/', ChatView.as_view(), name='chat'),
    path('generate-profiles/', GenerateProfilesView.as_view(), name='generate-profiles'),
]
