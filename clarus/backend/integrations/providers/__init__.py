"""Provider registry."""
from .base import Provider, ProviderError, IngestSink
from .github import GitHubProvider
from .gitlab import GitLabProvider
from .jira import JiraProvider
from .slack import SlackProvider

_REGISTRY = {
    p.slug: p for p in (GitHubProvider, GitLabProvider, JiraProvider, SlackProvider)
}


def get_provider(slug: str) -> Provider:
    cls = _REGISTRY.get(slug)
    if not cls:
        raise ProviderError(f'Unknown provider: {slug}')
    return cls()


def get_provider_class(slug: str):
    cls = _REGISTRY.get(slug)
    if not cls:
        raise ProviderError(f'Unknown provider: {slug}')
    return cls


def all_providers():
    return list(_REGISTRY.values())


__all__ = ['get_provider', 'get_provider_class', 'all_providers', 'Provider',
           'ProviderError', 'IngestSink']
