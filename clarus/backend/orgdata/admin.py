from django.contrib import admin

from .models import Commit, Contributor, Issue, Repository, RepositoryWork

admin.site.register(Repository)
admin.site.register(Contributor)
admin.site.register(RepositoryWork)
admin.site.register(Commit)
admin.site.register(Issue)
