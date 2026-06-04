from django.urls import path

from .views import (
    ChatView,
    ConfigView,
    GenerateProfilesView,
    TTSView,
    TwinChatView,
)

urlpatterns = [
    path('chat/', ChatView.as_view(), name='chat'),
    path('contributors/<int:pk>/chat/', TwinChatView.as_view(), name='twin-chat'),
    path('tts/', TTSView.as_view(), name='tts'),
    path('config/', ConfigView.as_view(), name='config'),
    path('generate-profiles/', GenerateProfilesView.as_view(), name='generate-profiles'),
]
