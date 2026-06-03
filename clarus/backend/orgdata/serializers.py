from rest_framework import serializers

from .models import Commit, Contributor, Issue, Repository, RepositoryWork


class RepositorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Repository
        fields = ('id', 'provider', 'name', 'url', 'avatar_url', 'description', 'summary', 'updated_at')


class CommitSerializer(serializers.ModelSerializer):
    class Meta:
        model = Commit
        fields = ('id', 'sha', 'url', 'message', 'summary', 'additions', 'deletions', 'authored_at')


class IssueSerializer(serializers.ModelSerializer):
    class Meta:
        model = Issue
        fields = ('id', 'external_id', 'url', 'title', 'state', 'is_pull_request', 'summary', 'created_at')


class RepositoryWorkSerializer(serializers.ModelSerializer):
    repository = serializers.IntegerField(source='repository_id')
    repository_name = serializers.CharField(source='repository.name', read_only=True)
    commits = CommitSerializer(many=True, read_only=True)
    issues = IssueSerializer(many=True, read_only=True)

    class Meta:
        model = RepositoryWork
        fields = ('id', 'repository', 'repository_name', 'summary',
                  'commit_count', 'issue_count', 'pr_count', 'commits', 'issues')


class ContributorSerializer(serializers.ModelSerializer):
    works = RepositoryWorkSerializer(many=True, read_only=True)

    class Meta:
        model = Contributor
        fields = ('id', 'provider', 'username', 'display_name', 'email',
                  'url', 'avatar_url', 'summary', 'works')


class ContributorListSerializer(serializers.ModelSerializer):
    """Lightweight version for list/graph views."""
    class Meta:
        model = Contributor
        fields = ('id', 'provider', 'username', 'display_name', 'url', 'avatar_url', 'summary')
