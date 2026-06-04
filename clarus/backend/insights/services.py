"""AI layer (Gemini via the OpenAI-compatible endpoint).

Two responsibilities:
1. ``generate_org_profiles`` — turn raw ingested activity into readable
   contributor profiles and repository summaries.
2. ``build_org_prompt`` / ``stream_chat`` — answer natural-language questions
   about the org by grounding the model in the ingested data.
"""
from __future__ import annotations

from django.conf import settings

from orgdata.models import Contributor, Repository

MAX_CONTRIBUTORS = 60
MAX_REPOS = 30
MAX_ITEMS_PER_SECTION = 25


def get_client():
    if not settings.GEMINI_API_KEY:
        return None
    from openai import OpenAI
    return OpenAI(api_key=settings.GEMINI_API_KEY, base_url=settings.GEMINI_BASE_URL)


def _complete(client, system, user):
    resp = client.chat.completions.create(
        model=settings.GEMINI_MODEL,
        messages=[{'role': 'system', 'content': system},
                  {'role': 'user', 'content': user}],
    )
    return (resp.choices[0].message.content or '').strip()


# ---------------------------------------------------------------- profiles ----
def _repo_summary(client, repo):
    commit_msgs = []
    for work in repo.works.all()[:MAX_ITEMS_PER_SECTION]:
        for commit in work.commits.all()[:5]:
            if commit.message:
                commit_msgs.append(f'- {commit.message}')
    sample = '\n'.join(commit_msgs[:40]) or '(no commit messages available)'
    system = ('You summarize software repositories for a knowledge base. '
              'Write 2-3 sentences describing what the repo is about and the '
              'main areas of work, based on the commit messages.')
    user = f'Repository: {repo.name}\nDescription: {repo.description}\n\nRecent commits:\n{sample}'
    return _complete(client, system, user)


def _contributor_summary(client, contributor):
    parts = []
    for work in contributor.works.select_related('repository').all():
        parts.append(f'\nRepository: {work.repository.name} '
                     f'({work.commit_count} commits, {work.pr_count} PRs, {work.issue_count} issues)')
        for commit in work.commits.all()[:6]:
            if commit.message:
                parts.append(f'  - commit: {commit.message}')
        for issue in work.issues.all()[:4]:
            if issue.title:
                kind = 'PR' if issue.is_pull_request else 'issue'
                parts.append(f'  - {kind}: {issue.title}')
    body = '\n'.join(parts)[:6000] or '(no activity)'
    system = ('You write concise expertise profiles of software contributors for '
              'an internal "who-knows-what" directory. In 3-4 sentences, describe '
              'their areas of expertise and the kind of work they do, grounded in '
              'the evidence. Be specific about technologies and components.')
    user = f'Contributor: {contributor.username}\nActivity:\n{body}'
    return _complete(client, system, user)


def generate_org_profiles(org):
    client = get_client()
    if not client:
        raise RuntimeError('GEMINI_API_KEY is not configured; cannot generate profiles.')

    repos = list(Repository.objects.filter(organization=org).prefetch_related(
        'works', 'works__commits')[:MAX_REPOS])
    for repo in repos:
        try:
            repo.summary = _repo_summary(client, repo)
            repo.save(update_fields=['summary'])
        except Exception:  # noqa: BLE001 - one failure shouldn't abort the batch
            continue

    contributors = list(
        Contributor.objects.filter(organization=org, works__isnull=False)
        .distinct()
        .prefetch_related('works', 'works__commits', 'works__issues', 'works__repository')
        [:MAX_CONTRIBUTORS]
    )
    done = 0
    for contributor in contributors:
        try:
            contributor.summary = _contributor_summary(client, contributor)
            contributor.save(update_fields=['summary'])
            done += 1
        except Exception:  # noqa: BLE001
            continue
    return {'repositories': len(repos), 'contributors': done}


# ------------------------------------------------------------------- chat ----
SYSTEM_PROMPT = """You are Clarus, an assistant that helps people understand a \
software organization and find the right experts.
You are given a list of repositories and contributors with their summarized \
contributions. Answer the user's question and identify the most relevant \
contributor(s).
Each contributor has a unique id. When you mention a contributor, use the format:
<contributor id="ID">Name</contributor>
Answer in markdown, explain your reasoning, and ground claims in the data."""


def build_org_prompt(org, question):
    lines = ['## Repositories\n']
    for repo in Repository.objects.filter(organization=org)[:MAX_REPOS]:
        lines.append(f'### {repo.name} (id: {repo.id})')
        lines.append(repo.summary or repo.description or 'No summary.')
        lines.append('')
    lines.append('\n## Contributors\n')
    contributors = (Contributor.objects.filter(organization=org, works__isnull=False)
                    .distinct().prefetch_related('works', 'works__repository')[:MAX_CONTRIBUTORS])
    for c in contributors:
        lines.append(f'### {c.username} (id: {c.id})')
        if c.summary:
            lines.append(c.summary)
        repos = ', '.join(w.repository.name for w in c.works.all()[:10])
        if repos:
            lines.append(f'Works on: {repos}')
        lines.append('')
    lines.append('\n## Question\n')
    lines.append(question)
    return '\n'.join(lines)


def build_twin_prompt(contributor, question):
    parts = []
    for work in contributor.works.select_related('repository').all():
        parts.append(f'\nRepository: {work.repository.name} '
                     f'({work.commit_count} commits, {work.pr_count} PRs, {work.issue_count} issues)')
        for commit in work.commits.all()[:10]:
            if commit.message:
                parts.append(f'  - commit: {commit.message}')
        for issue in work.issues.all()[:6]:
            if issue.title:
                kind = 'PR' if issue.is_pull_request else 'issue'
                parts.append(f'  - {kind}: {issue.title}')
    evidence = '\n'.join(parts)[:8000] or '(no recorded activity)'
    profile = contributor.summary or '(no profile yet)'
    return (f'## Your profile\n{profile}\n\n## Evidence of your work\n{evidence}\n\n'
            f'## Question for you\n{question}')


def twin_system_prompt(contributor):
    name = contributor.display_name or contributor.username
    return (
        f"You are the AI 'digital twin' of {name}, a software contributor. "
        f"You are built from {name}'s actual work — commits, issues and pull "
        f"requests. Answer in the first person as {name}, grounded strictly in "
        f"the evidence of your work provided. Be concrete about the components, "
        f"technologies and areas you've worked on. If a question goes beyond what "
        f"your work shows, say you're not certain rather than inventing details. "
        f"Keep replies concise and in markdown."
    )


def stream_twin_chat(contributor, question):
    client = get_client()
    if not client:
        yield 'Error: GEMINI_API_KEY is not configured on the server.'
        return
    try:
        stream = client.chat.completions.create(
            model=settings.GEMINI_MODEL,
            messages=[{'role': 'system', 'content': twin_system_prompt(contributor)},
                      {'role': 'user', 'content': build_twin_prompt(contributor, question)}],
            stream=True,
        )
        for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content
    except Exception as e:  # noqa: BLE001
        yield f'\n\nError contacting the AI model: {e}'


def stream_chat(org, question):
    client = get_client()
    if not client:
        yield 'Error: GEMINI_API_KEY is not configured on the server.'
        return
    prompt = build_org_prompt(org, question)
    try:
        stream = client.chat.completions.create(
            model=settings.GEMINI_MODEL,
            messages=[{'role': 'system', 'content': SYSTEM_PROMPT},
                      {'role': 'user', 'content': prompt}],
            stream=True,
        )
        for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content
    except Exception as e:  # noqa: BLE001
        yield f'\n\nError contacting the AI model: {e}'
