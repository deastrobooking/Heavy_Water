# Ultimate Git and GitHub Guide

This guide is a practical field manual for using Git and GitHub without
accidentally wrecking your project. It is written for day-to-day development:
checking status, making clean commits, syncing with GitHub, opening pull
requests, fixing conflicts, undoing mistakes, and protecting a repository.

Use Git for local history. Use GitHub for collaboration, review, automation,
issues, releases, and remote backups.

## Table of contents

- [Mental model](#mental-model)
- [One-time setup](#one-time-setup)
- [The daily loop](#the-daily-loop)
- [Repository basics](#repository-basics)
- [Reading status and history](#reading-status-and-history)
- [Branches](#branches)
- [Staging and committing](#staging-and-committing)
- [Syncing with GitHub](#syncing-with-github)
- [Pull requests](#pull-requests)
- [Code review](#code-review)
- [Merge strategies](#merge-strategies)
- [Conflict resolution](#conflict-resolution)
- [Undo and recovery](#undo-and-recovery)
- [Stash workflow](#stash-workflow)
- [Tags and releases](#tags-and-releases)
- [GitHub issues and projects](#github-issues-and-projects)
- [GitHub Actions](#github-actions)
- [Security and repository protection](#security-and-repository-protection)
- [Large files and assets](#large-files-and-assets)
- [Git ignore rules](#git-ignore-rules)
- [Submodules and monorepos](#submodules-and-monorepos)
- [Command cheat sheet](#command-cheat-sheet)
- [Team conventions](#team-conventions)
- [Heavy Water notes](#heavy-water-notes)
- [Troubleshooting recipes](#troubleshooting-recipes)
- [Official references](#official-references)

## Mental model

Git tracks snapshots, not just text changes. Every commit is a snapshot of the
project tree plus metadata: author, date, message, and parent commit.

The three local areas:

- Working tree: files on disk.
- Staging area, also called the index: what will go into the next commit.
- Repository: committed history inside `.git/`.

The common flow:

```bash
edit files
git status
git diff
git add <files>
git commit -m "Describe the change"
git push
```

The common collaboration flow:

```bash
git switch main
git pull --ff-only
git switch -c feature/my-change
# edit, test, commit
git push -u origin feature/my-change
# open a pull request on GitHub
```

Important names:

- `HEAD`: the commit currently checked out.
- `main`: the local branch named `main`.
- `origin`: the default remote, usually GitHub.
- `origin/main`: your local record of GitHub's `main` branch after the last
  `git fetch`.
- `working tree clean`: no uncommitted tracked changes.
- `untracked file`: Git sees it, but it is not part of history yet.

## One-time setup

Configure your identity:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Set a safer default branch name for new repos:

```bash
git config --global init.defaultBranch main
```

Set the default pull behavior. Pick one style and stick with it.

Fast-forward only, best for people who want explicit control:

```bash
git config --global pull.ff only
```

Rebase local commits on top of remote changes:

```bash
git config --global pull.rebase true
```

Set a better default editor if needed:

```bash
git config --global core.editor "code --wait"
```

Enable helpful conflict reuse:

```bash
git config --global rerere.enabled true
```

Recommended aliases:

```bash
git config --global alias.st "status -sb"
git config --global alias.co "switch"
git config --global alias.br "branch"
git config --global alias.cm "commit -m"
git config --global alias.lg "log --oneline --graph --decorate --all"
git config --global alias.unstage "restore --staged"
```

Check your config:

```bash
git config --list --show-origin
```

## Repository basics

Create a new repo:

```bash
mkdir my-project
cd my-project
git init
```

Clone an existing GitHub repo:

```bash
git clone https://github.com/OWNER/REPO.git
cd REPO
```

Add a remote to an existing local repo:

```bash
git remote add origin https://github.com/OWNER/REPO.git
git branch -M main
git push -u origin main
```

Inspect remotes:

```bash
git remote -v
```

Change a remote URL:

```bash
git remote set-url origin https://github.com/OWNER/NEW-REPO.git
```

## Reading status and history

Start every Git operation with status:

```bash
git status -sb
```

Use the short status codes:

- `M file`: modified tracked file.
- `A file`: added file.
- `D file`: deleted file.
- `R old -> new`: renamed file.
- `?? file`: untracked file.
- `UU file`: conflict needs resolution.

See unstaged edits:

```bash
git diff
```

See staged edits:

```bash
git diff --staged
```

See recent commits:

```bash
git log --oneline -10
```

See a graph:

```bash
git log --oneline --graph --decorate --all
```

Inspect one commit:

```bash
git show <commit>
```

Compare branches:

```bash
git diff main..feature/my-change
git log main..feature/my-change --oneline
```

Compare local branch to GitHub:

```bash
git fetch origin
git status -sb
git log --oneline HEAD..origin/main
git log --oneline origin/main..HEAD
```

## Branches

Branches are movable names pointing at commits. A feature branch lets you work
without disturbing `main`.

List branches:

```bash
git branch
git branch -a
```

Create and switch:

```bash
git switch -c feature/new-system
```

Switch to an existing branch:

```bash
git switch main
```

Rename current branch:

```bash
git branch -m better-name
```

Delete a merged local branch:

```bash
git branch -d feature/new-system
```

Force delete an unmerged local branch only when you are sure:

```bash
git branch -D feature/abandoned
```

Delete a remote branch:

```bash
git push origin --delete feature/abandoned
```

Track a remote branch:

```bash
git switch --track origin/feature/someone-else
```

Good branch names:

- `feature/player-swimming`
- `fix/replit-build`
- `docs/git-guide`
- `chore/update-deps`
- `hotfix/login-crash`

## Staging and committing

Stage specific files:

```bash
git add client/src/game/PlayerController.ts
```

Stage everything changed under the current directory:

```bash
git add .
```

Stage pieces interactively:

```bash
git add -p
```

Unstage a file:

```bash
git restore --staged <file>
```

Commit:

```bash
git commit -m "Add swimming stamina meter"
```

Commit with a longer body:

```bash
git commit
```

Amend the last commit message:

```bash
git commit --amend
```

Amend the last commit with additional staged files:

```bash
git add <file>
git commit --amend --no-edit
```

Good commit messages:

```text
Add water collision fallback
Fix Replit production build path
Document Git recovery workflow
Refactor terrain height sampling
```

Bad commit messages:

```text
updates
stuff
fix
wip
final final
```

Commit hygiene:

- One logical change per commit.
- Keep generated files out unless the project intentionally tracks them.
- Run the relevant check before committing.
- Read your diff before committing.
- Do not commit secrets.

## Syncing with GitHub

`fetch` downloads remote history without changing your files:

```bash
git fetch origin
```

`pull` is fetch plus integrate:

```bash
git pull --ff-only
```

Push your branch:

```bash
git push
```

First push for a new branch:

```bash
git push -u origin feature/my-change
```

Bring local `main` up to date safely:

```bash
git switch main
git pull --ff-only
```

Update a feature branch with latest `main` using merge:

```bash
git switch feature/my-change
git fetch origin
git merge origin/main
```

Update a feature branch with latest `main` using rebase:

```bash
git switch feature/my-change
git fetch origin
git rebase origin/main
```

Use merge when you want to preserve exact branch history. Use rebase when you
want a cleaner linear branch before review. Avoid rebasing commits that other
people are already building on unless the team has agreed to that workflow.

## Pull requests

A pull request asks the team to review and merge one branch into another.

Typical PR workflow:

```bash
git switch main
git pull --ff-only
git switch -c feature/inventory-filter
# edit files
npm run check
git add .
git commit -m "Add inventory filter"
git push -u origin feature/inventory-filter
```

Then open a pull request from `feature/inventory-filter` into `main`.

A strong PR includes:

- Clear title.
- What changed.
- Why it changed.
- How it was tested.
- Screenshots or recordings for UI changes.
- Known risks or follow-up work.

PR title examples:

```text
Add inventory filter controls
Fix terrain height fallback on Replit
Document Git and GitHub workflow
```

PR description template:

```markdown
## Summary

- Summary item.

## Testing

- [ ] npm run check
- [ ] Manual smoke test

## Notes

- Notes or follow-up.
```

Before opening a PR:

```bash
git status -sb
git diff --staged
git log --oneline origin/main..HEAD
```

After review comments:

```bash
# edit files
npm run check
git add .
git commit -m "Address review feedback"
git push
```

## Code review

As an author:

- Keep PRs small enough to review.
- Explain risky choices.
- Respond to each thread.
- Prefer follow-up commits during review.
- Squash at merge if the repo uses squash merging.

As a reviewer:

- Prioritize correctness, safety, tests, maintainability, and user impact.
- Quote exact files and lines when possible.
- Separate blocking issues from suggestions.
- Ask questions when intent is unclear.
- Do not use review as a style debate unless style affects readability or
  consistency.

Useful review labels:

- `bug`
- `docs`
- `feature`
- `needs-review`
- `blocked`
- `ready-to-merge`

## Merge strategies

GitHub usually offers three merge styles. Repository settings decide which are
allowed.

Merge commit:

- Preserves the full feature branch history.
- Adds a merge commit.
- Good for large branches where exact history matters.

Squash merge:

- Combines the PR into one commit on `main`.
- Keeps `main` clean.
- Good default for small and medium PRs.

Rebase merge:

- Replays commits from the PR onto `main`.
- Keeps a linear history.
- Best when each commit is clean and meaningful.

Good default for many teams:

- Feature branches can be messy during work.
- PRs are reviewed.
- CI must pass.
- Squash merge to `main`.
- Delete feature branches after merge.

## Conflict resolution

A conflict happens when Git cannot automatically combine changes.

During merge or rebase, check status:

```bash
git status -sb
```

Open conflicted files and look for markers:

```text
start marker: <<<<<<< HEAD
current branch version
separator: =======
incoming version
end marker: >>>>>>> other-branch
```

Edit the file so it contains the correct final version. Remove all conflict
markers.

Then:

```bash
git add <resolved-file>
```

Finish a merge:

```bash
git commit
```

Finish a rebase:

```bash
git rebase --continue
```

Abort a merge:

```bash
git merge --abort
```

Abort a rebase:

```bash
git rebase --abort
```

Conflict tips:

- Resolve one file at a time.
- Run tests after resolving.
- Do not blindly pick "ours" or "theirs" unless you understand both sides.
- If generated files conflict, regenerate them if possible.

## Undo and recovery

This is the part that saves projects.

### See what happened

```bash
git status -sb
git diff --stat
git diff --name-status
git log --oneline -10
```

### Discard changes in one file

This restores a file from `HEAD`:

```bash
git restore <file>
```

### Discard all unstaged local changes

Only do this when you are sure you do not need the local edits:

```bash
git restore .
```

### Restore deleted tracked files

If many tracked files were deleted locally but the repo online is fine:

```bash
git fetch origin
git restore --source=origin/main --staged --worktree .
```

This is the safe recovery pattern for "my local checkout got emptied, but
GitHub is correct."

### Unstage files

```bash
git restore --staged <file>
git restore --staged .
```

### Restore a file from another branch or commit

```bash
git restore --source=origin/main -- path/to/file
git restore --source=<commit> -- path/to/file
```

### Revert a committed change safely

Use `revert` for commits already pushed to shared branches:

```bash
git revert <commit>
git push
```

This creates a new commit that undoes the old one.

### Reset local commits that have not been pushed

Move branch back but keep changes staged:

```bash
git reset --soft HEAD~1
```

Move branch back and keep changes unstaged:

```bash
git reset --mixed HEAD~1
```

Move branch back and throw away changes:

```bash
git reset --hard HEAD~1
```

Be extremely careful with `reset --hard`; it destroys local work in the
working tree and index.

### Find lost commits

Use the reflog:

```bash
git reflog
```

Recover a lost branch:

```bash
git switch -c recovered-work <commit-from-reflog>
```

### Recover a deleted branch from GitHub

If a pull request existed, GitHub often provides a restore branch option on the
closed or merged PR page. Locally, you can also recreate a branch if you know
the commit:

```bash
git switch -c restored-branch <commit>
git push -u origin restored-branch
```

## Stash workflow

Use stash when you need a clean tree but are not ready to commit.

Stash tracked changes:

```bash
git stash push -m "WIP terrain experiment"
```

Include untracked files:

```bash
git stash push -u -m "WIP with new files"
```

List stashes:

```bash
git stash list
```

Inspect a stash:

```bash
git stash show -p stash@{0}
```

Apply but keep the stash:

```bash
git stash apply stash@{0}
```

Apply and remove the stash:

```bash
git stash pop
```

Delete a stash:

```bash
git stash drop stash@{0}
```

Create a branch from a stash:

```bash
git stash branch recovered-wip stash@{0}
```

## Tags and releases

Tags mark important commits, usually versions.

Lightweight tag:

```bash
git tag v1.0.0
```

Annotated tag:

```bash
git tag -a v1.0.0 -m "Release v1.0.0"
```

Push a tag:

```bash
git push origin v1.0.0
```

Push all tags:

```bash
git push origin --tags
```

Delete a local tag:

```bash
git tag -d v1.0.0
```

Delete a remote tag:

```bash
git push origin --delete v1.0.0
```

Release checklist:

- Version number chosen.
- Changelog updated.
- Tests pass.
- Build artifacts generated if needed.
- Tag pushed.
- GitHub Release created with notes.

## GitHub issues and projects

Use issues to track work, bugs, decisions, and follow-ups.

Good issue titles:

```text
Fix terrain loading failure on cold Replit start
Add save migration for inventory slots
Investigate frame drops near dense foliage
```

Good issue body:

```markdown
## Problem

What is wrong or missing?

## Expected behavior

What should happen instead?

## Reproduction

1. First step.
2. Second step.
3. Third step.

## Notes

- Logs:
- Screenshots:
- Related files:
```

Useful issue labels:

- `bug`
- `enhancement`
- `documentation`
- `good first issue`
- `help wanted`
- `blocked`
- `needs-design`

Use milestones for release goals. Use Projects for boards, priorities, and
cross-repo planning.

## GitHub Actions

GitHub Actions runs workflows from YAML files in `.github/workflows/`.
Workflows can run on pushes, pull requests, schedules, manual triggers, and
other GitHub events.

Minimal Node/TypeScript CI:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install
        run: npm ci

      - name: Typecheck
        run: npm run check
```

Common workflow parts:

- Workflow: the whole YAML automation.
- Event: what starts it, such as `push` or `pull_request`.
- Job: a group of steps running on a runner.
- Step: one command or action.
- Runner: the machine that executes the job.
- Matrix: run the same job across versions or platforms.

Useful Actions practices:

- Use `npm ci` in CI, not `npm install`.
- Pin important third-party actions by version, or by commit SHA for stricter
  security.
- Cache dependencies when it meaningfully saves time.
- Keep secrets in GitHub Secrets, not in files.
- Use least-privilege permissions.

Example permissions block:

```yaml
permissions:
  contents: read
```

Run a workflow manually:

```yaml
on:
  workflow_dispatch:
```

Cancel duplicate runs on the same branch:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

## Security and repository protection

Protect important branches. For most repos, protect `main`.

Recommended protections:

- Require pull requests before merging.
- Require at least one approval.
- Require status checks to pass.
- Require conversation resolution.
- Block force pushes.
- Block deletions.
- Require linear history if the team wants squash or rebase merges only.
- Add CODEOWNERS for sensitive areas.
- Use rulesets for broader, reusable policy enforcement.

Do not push secrets:

- API keys.
- Database URLs.
- Private keys.
- OAuth client secrets.
- Production credentials.
- `.env` files unless they are sanitized examples.

If a secret is committed:

1. Revoke the secret immediately.
2. Replace it with a new secret.
3. Remove it from the repo.
4. Rewrite history only if necessary and coordinated.
5. Rotate any dependent credentials.

Recommended files:

```text
.env
.env.local
.env.*.local
```

Recommended example file:

```text
.env.example
```

GitHub security features to consider:

- Dependabot alerts.
- Dependabot version updates.
- Secret scanning.
- Code scanning.
- Branch protections or rulesets.
- Required status checks.

## Large files and assets

Git is not great at frequently changing large binary files. Game projects often
have models, textures, music, and build outputs, so be deliberate.

Track source assets when they are required to build or run the project.
Ignore generated artifacts when they can be recreated.

Consider Git LFS for very large binary assets:

```bash
git lfs install
git lfs track "*.psd"
git lfs track "*.wav"
git add .gitattributes
git commit -m "Track large assets with Git LFS"
```

Before adding a large asset:

```bash
du -h path/to/asset
git status -sb
```

Find large tracked files:

```bash
git rev-list --objects --all | sort
```

For a deeper large-file audit, use tools like `git-sizer` or `git-filter-repo`.

## Git ignore rules

`.gitignore` prevents untracked generated files from showing up in status.

Common Node ignores:

```gitignore
node_modules
dist
.env
.env.local
npm-debug.log*
```

Important: `.gitignore` does not stop Git from tracking a file that is already
tracked. To stop tracking a file but keep it locally:

```bash
git rm --cached <file>
git commit -m "Stop tracking generated file"
```

Ignore local-only Git noise:

```gitignore
.DS_Store
```

Use `.env.example` to document required environment variables without exposing
real values.

## Submodules and monorepos

Submodules are repositories nested inside another repository. They are useful
but easy to misuse.

Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/OWNER/REPO.git
```

Initialize after clone:

```bash
git submodule update --init --recursive
```

Update submodules:

```bash
git submodule update --remote --merge
```

Prefer a monorepo when:

- Projects are released together.
- Shared code changes frequently.
- CI can handle the combined repo.

Prefer separate repos when:

- Projects have different owners.
- Release cycles differ.
- Access control must differ.
- Repo size would become painful.

## Command cheat sheet

Status:

```bash
git status -sb
git diff
git diff --staged
```

History:

```bash
git log --oneline -10
git log --oneline --graph --decorate --all
git show <commit>
```

Branches:

```bash
git branch
git switch main
git switch -c feature/name
git branch -d feature/name
```

Stage and commit:

```bash
git add <file>
git add -p
git restore --staged <file>
git commit -m "Message"
```

Sync:

```bash
git fetch origin
git pull --ff-only
git push
git push -u origin feature/name
```

Restore:

```bash
git restore <file>
git restore .
git restore --source=origin/main --staged --worktree .
```

Revert:

```bash
git revert <commit>
```

Reset:

```bash
git reset --soft HEAD~1
git reset --mixed HEAD~1
git reset --hard HEAD~1
```

Stash:

```bash
git stash push -m "WIP"
git stash list
git stash pop
```

Tags:

```bash
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

Cleanup:

```bash
git remote prune origin
git branch --merged
```

## Team conventions

Recommended lightweight team workflow:

1. `main` is always deployable.
2. Work happens on short-lived feature branches.
3. Every change goes through a pull request.
4. CI must pass before merge.
5. Squash merge by default.
6. Delete branches after merge.
7. Use issues for bugs and planned work.
8. Keep secrets out of Git.
9. Update docs with behavior changes.

Suggested branch naming:

```text
feature/<short-topic>
fix/<short-topic>
docs/<short-topic>
chore/<short-topic>
hotfix/<short-topic>
```

Suggested commit prefixes when useful:

```text
feat:
fix:
docs:
refactor:
test:
chore:
build:
ci:
```

Example:

```bash
git commit -m "fix: restore Replit static build path"
```

Keep prefixes optional unless the repo uses automated release tooling that
depends on them.

## Heavy Water notes

This repository is the web/Replit version of Heavy Water. The desktop version
is a separate sibling repository.

Useful local check:

```bash
pwd
git remote -v
git status -sb
```

Expected web repo remote:

```text
https://github.com/deastrobooking/Heavy_Water.git
```

Expected desktop repo remote:

```text
https://github.com/deastrobooking/Heavy-Water-Desktop.git
```

Before changing files, make sure you are in the right folder:

```bash
pwd
git remote -v
```

The Replit/web repo uses:

```bash
npm run dev
npm run build
npm run check
```

Before committing in this repo:

```bash
git status -sb
npm run check
git diff --staged
```

If the local web checkout is accidentally emptied but GitHub is correct:

```bash
git fetch origin
git restore --source=origin/main --staged --worktree .
git status -sb
```

Do not commit a status showing mass deletions unless deleting the whole project
is truly the intended change.

## Troubleshooting recipes

### "I am on the wrong branch"

If you have no local changes:

```bash
git switch correct-branch
```

If you have local changes:

```bash
git stash push -u -m "WIP before branch switch"
git switch correct-branch
git stash pop
```

### "I committed to main by mistake"

If not pushed:

```bash
git switch -c feature/rescue-work
git switch main
git reset --hard origin/main
git switch feature/rescue-work
```

If pushed, open a PR or revert depending on team policy.

### "I need to rename a branch"

Local rename:

```bash
git branch -m new-name
```

Rename remote branch:

```bash
git push -u origin new-name
git push origin --delete old-name
```

### "My branch has diverged"

Inspect first:

```bash
git status -sb
git log --oneline --graph --decorate --all -20
```

Then choose one:

```bash
git merge origin/main
```

or:

```bash
git rebase origin/main
```

### "I need one commit from another branch"

```bash
git cherry-pick <commit>
```

### "I accidentally staged too much"

```bash
git restore --staged .
git add -p
```

### "I accidentally deleted a tracked file"

```bash
git restore path/to/file
```

### "I accidentally deleted many tracked files"

```bash
git status -sb
git restore .
```

If GitHub has the correct copy:

```bash
git fetch origin
git restore --source=origin/main --staged --worktree .
```

### "I need to see who changed a line"

```bash
git blame path/to/file
```

### "I need to find when a bug was introduced"

```bash
git bisect start
git bisect bad
git bisect good <known-good-commit>
# test each checkout, then:
git bisect good
# or:
git bisect bad
git bisect reset
```

### "Git says there is an index.lock"

Make sure no Git process is still running. If not, remove the stale lock:

```bash
rm .git/index.lock
```

Only remove a lock file when you are sure no Git operation is active.

### "I need a clean copy without touching this folder"

Clone into a fresh folder:

```bash
git clone https://github.com/OWNER/REPO.git ../repo-clean
```

## Official references

- Git Book: https://git-scm.com/book/en/v2
- Git cheat sheet: https://git-scm.com/docs
- GitHub pull requests: https://docs.github.com/en/pull-requests
- GitHub Actions: https://docs.github.com/en/actions
- GitHub branch protection: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches
- GitHub rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets
