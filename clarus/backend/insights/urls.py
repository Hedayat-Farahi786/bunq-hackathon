from django.urls import path

from .views import ChatView, GenerateProfilesView, TwinChatView

urlpatterns = [
    path('chat/', ChatView.as_view(), name='chat'),
    path('contributors/<int:pk>/chat/', TwinChatView.as_view(), name='twin-chat'),
    path('generate-profiles/', GenerateProfilesView.as_view(), name='generate-profiles'),
]
