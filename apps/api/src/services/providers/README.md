# SCM Provider Implementation Guide

This directory contains the implementation of the SCM (Source Code Management) provider abstraction layer for DocSynth. This enables DocSynth to work with multiple SCM platforms: GitHub, GitLab, and Bitbucket.

## Architecture

The provider system consists of:

1. **Interface Definition** (`../scm-provider.ts`) - Common interface and types
2. **Provider Implementations** (this directory) - Platform-specific implementations
3. **Factory** (`../scm-provider-factory.ts`) - Provider creation and detection utilities
4. **Routes** (`../../routes/scm-providers.ts`) - REST API endpoints

## Provider Implementations

### GitHub Provider (`github.provider.ts`)

Wraps the existing `@docsynth/github` package (Octokit) to implement the SCMProvider interface.

**Configuration:**
```typescript
{
  installationId: number
}
```

**Features:**
- Full GitHub App integration
- Check runs support
- HMAC webhook signature verification
- Complete PR, commit, and file operations

### GitLab Provider (`gitlab.provider.ts`)

Implements SCMProvider using GitLab REST API (v4) via fetch.

**Configuration:**
```typescript
{
  token: string,           // Personal Access Token or OAuth token
  baseUrl?: string        // Optional: defaults to https://gitlab.com/api/v4
}
```

**Features:**
- Merge requests (GitLab's equivalent to PRs)
- Commit statuses (instead of check runs)
- Token-based webhook verification
- Self-hosted GitLab support via baseUrl

**Notes:**
- Merge requests use `iid` (project-specific ID) not global ID
- Commit statuses are created, not updated (GitLab limitation)

### Bitbucket Provider (`bitbucket.provider.ts`)

Implements SCMProvider using Bitbucket REST API (2.0) via fetch.

**Configuration:**
```typescript
{
  username: string,
  appPassword: string,
  baseUrl?: string        // Optional: defaults to https://api.bitbucket.org/2.0
}
```

**Features:**
- Pull requests support
- Build statuses (instead of check runs)
- Basic webhook verification via User-Agent
- Repository operations

**Notes:**
- Uses Basic Auth with App Passwords
- Webhook signature verification is limited (relies on User-Agent or custom headers)
- Build statuses are created, not updated

## Usage Examples

### Creating a Provider

```typescript
import { createSCMProvider } from '../services/scm-provider-factory.js';

// GitHub
const githubProvider = createSCMProvider('github', {
  installationId: 12345,
});

// GitLab
const gitlabProvider = createSCMProvider('gitlab', {
  token: 'glpat-xxxxxxxxxxxxxxxxxxxx',
  baseUrl: 'https://gitlab.example.com/api/v4', // optional
});

// Bitbucket
const bitbucketProvider = createSCMProvider('bitbucket', {
  username: 'myuser',
  appPassword: 'xxxxxxxxxxxxxx',
});
```

### Detecting Provider from URL

```typescript
import { detectProvider, parseRepoUrl } from '../services/scm-provider-factory.js';

const url = 'https://github.com/owner/repo';
const providerType = detectProvider(url); // => 'github'
const { owner, repo } = parseRepoUrl(url); // => { owner: 'owner', repo: 'repo' }
```

### Using the Provider

```typescript
// Get repository info
const repo = await provider.getRepository('owner', 'repo');

// Get a pull request
const pr = await provider.getPullRequest('owner', 'repo', 123);

// Get changed files in PR
const files = await provider.getPRFiles('owner', 'repo', 123);

// Create a PR comment
await provider.createPRComment('owner', 'repo', 123, 'Great work!');

// Create a check run / status
const check = await provider.createCheckRun('owner', 'repo', {
  name: 'DocSynth',
  headSha: 'abc123',
  status: 'completed',
  conclusion: 'success',
  title: 'Documentation Coverage',
  summary: 'All docs are up to date!',
});
```

## API Endpoints

See `../../routes/scm-providers.ts` for the REST API implementation.

**Available endpoints:**
- `GET /api/scm-providers` - List supported providers
- `POST /api/scm-providers/test` - Test provider connection
- `GET /api/scm-providers/:repositoryId` - Get provider for repo
- `PUT /api/scm-providers/:repositoryId` - Configure provider for repo
- `POST /api/scm-providers/detect` - Detect provider from URL
- `GET /api/scm-providers/stats/organization` - Organization provider stats
- `POST /api/scm-providers/:repositoryId/migrate` - Migrate repo to different provider

## Adding a New Provider

To add support for a new SCM platform:

1. Create a new provider file in this directory (e.g., `azure-devops.provider.ts`)
2. Implement the `SCMProvider` interface from `../scm-provider.ts`
3. Add the provider type to `SCMProviderType` in `../scm-provider.ts`
4. Update the factory in `../scm-provider-factory.ts`:
   - Add to `createSCMProvider()` switch statement
   - Add detection logic to `detectProvider()`
   - Add capabilities in `getProviderCapabilities()`
5. Update `getSupportedProviders()` to include the new type

## Testing

Each provider should be tested with:
- Repository operations (get repo, files, etc.)
- Pull/Merge request operations
- Commit operations
- Webhook payload parsing and signature verification
- Check/Status operations

## Platform-Specific Notes

### GitHub
- Uses GitHub Apps for authentication
- Full check runs API support
- Strong webhook signature verification (HMAC SHA256)

### GitLab
- Uses Personal Access Tokens or OAuth
- Commit statuses instead of check runs
- Token-based webhook verification
- Supports self-hosted instances

### Bitbucket
- Uses App Passwords for authentication
- Build statuses instead of check runs
- Limited webhook verification
- UUIDs are used as repository IDs (converted to numbers)

## Security Considerations

1. **Credentials Storage**: Never store credentials in code or version control
2. **Webhook Verification**: Always verify webhook signatures when available
3. **Token Permissions**: Use minimum required permissions for access tokens
4. **HTTPS Only**: All API requests should use HTTPS
5. **Rate Limiting**: Implement rate limiting and respect platform limits

## Performance Tips

1. **Caching**: Cache repository metadata and file contents when appropriate
2. **Pagination**: Handle paginated responses for large result sets
3. **Batch Operations**: Use batch APIs when available
4. **Webhooks**: Prefer webhooks over polling for real-time updates
5. **Error Handling**: Implement retries with exponential backoff

## References

- [GitHub REST API](https://docs.github.com/en/rest)
- [GitLab REST API](https://docs.gitlab.com/ee/api/)
- [Bitbucket REST API](https://developer.atlassian.com/cloud/bitbucket/rest/)
