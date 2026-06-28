# VaultEdge Publishing & Release Guide

VaultEdge automates builds, verification, and package publishing using **GitHub Actions**. Whenever a new git tag matching `v*` (e.g., `v1.0.0`) is pushed to the repository, the release pipeline publishes to npm, PyPI, and Docker Hub automatically.

---

## 🛠️ Required Secrets

To enable publishing, make sure to add the following secrets under **Settings > Secrets and variables > Actions** in your GitHub repository:

| Secret Name | Purpose | How to obtain |
|---|---|---|
| `NPM_TOKEN` | Publishing NPM packages (`@durgadas/vaultedge-core`, `vaultedge-sdk`, `@durgadas/vaultedge-cli`) | Generate a **Publish** automation token from [npmjs.com](https://www.npmjs.com) |
| `DOCKERHUB_USERNAME` | Logging into Docker Hub for pushing images | Your Docker Hub user ID |
| `DOCKERHUB_TOKEN` | Authenticating with Docker Hub | Generate a Personal Access Token (PAT) from Docker Hub Account Settings |
| `DOCKERHUB_REPO` | (Optional) Custom Docker repository name | E.g., `myusername/vaultedge-proxy` (Defaults to `vaultedge/proxy` if omitted) |

> **PyPI Trusted Publishing**: VaultEdge's Python SDK publish job uses the official PyPI trusted publisher workflow, which uses OIDC tokens. You don't need to specify a `PYPI_API_TOKEN` secret. Simply configure Trusted Publishing in your PyPI project settings pointing to your repository name.

---

## 🚀 Release Process

To publish a new version of all packages:

### 1. Update version numbers

Update the version number in all configuration manifests:
- **Root**: `package.json`
- **Core**: `packages/core/package.json`
- **SDK**: `packages/sdk/package.json` and change the `@durgadas/vaultedge-core` dependency if needed.
- **CLI**: `packages/cli/package.json` and change `@durgadas/vaultedge-core` dependency.
- **Proxy**: `apps/proxy/package.json`
- **Python**: `sdks/python/pyproject.toml` (under `version = "..."` and `__version__` in `vaultedge/__init__.py`)
- **Go**: Update version tags or comments.

### 2. Commit and Tag

Create a commit with the release version and tag it:

```bash
# Commit the version changes
git commit -am "release: v1.0.0"

# Tag the commit
git tag v1.0.0

# Push the branch and tag to GitHub
git push origin main
git push origin v1.0.0
```

### 3. Verify Release Build

1. Go to your repository on GitHub.
2. Click on the **Actions** tab.
3. You will see the **CI/CD Pipeline** trigger.
4. Once the verification steps pass, the publishing jobs will run in parallel, pushing the packages to npm, PyPI, and the proxy server image to Docker Hub.
