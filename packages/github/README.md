# @skillcdn/github

The GitHub implementation of the git-host ports defined in `@skillcdn/core`. It is the only place in the codebase that talks to GitHub.

**Status:** reading repositories with the deployment's credential or the app's installation token, signing in and the permission question, the public listing of an account, and reading the deliveries of the app's webhook are implemented.

## Scope

| Capability | Used for | Credential |
|---|---|---|
| Resolve a ref to a commit of the repository's own: a name among its branches and then its tags, a commit hash by comparison with the default branch ([ADR-0039](../../docs/adr/0039-an-address-serves-only-what-is-the-repositorys-own.md)); read trees, blobs and archives (`GitHost`) | Indexing and reads | None or an optional token for public repos; the App installation token when the coordinates say `credential: "installation"` |
| Installation tokens (`GitHubApp`) | Private repos | The app's private key: a short-lived app token finds the installation that covers a repository and mints a token for it, restricted to reading contents and metadata |
| Signing in, "which repository does this name mean to this person", where the app is installed for them (`GitHostLogin`) | Sessions, the permission check, the account pages | The app's client id and secret; the person's token |
| An account's profile and public repositories (`GitHostDirectory`) | The page of an account | None or the optional token |
| The app's webhook deliveries (`GitHostEventSource`) | Verifying the signature of a delivery over its raw body, then reading what it ends: refs after a push, what is known about a repository that changed or closed, the answers about who sees what after a change of collaborators, teams or members, an installation that was removed, a person who revoked the app ([ADR-0038](../../docs/adr/0038-the-git-hosts-events-end-what-is-remembered.md)) | The webhook secret |

Another host would be a package of its own that implements the same ports; GitLab and Gitea adapters are planned ([roadmap](../../docs/roadmap.md)).

## Usage

```ts
import { createGitHubHost } from "@skillcdn/github";

const gitHost = createGitHubHost({
  userAgent: "skillcdn",
  token: async () => config.githubToken, // optional; only raises the rate limit for public repos
});
const commit = await gitHost.resolveRef({ host: "gh", owner: "acme", repo: "skills" }, undefined);
```

With an app, one connection serves both adapters, so they share the HTTP client and the app's cached tokens:

```ts
import { connectGitHub, createGitHubHost, createGitHubLogin } from "@skillcdn/github";

const options = { userAgent: "skillcdn", app: { appId, privateKey }, clientId, clientSecret };
const connection = connectGitHub(options);
const gitHost = createGitHubHost(options, connection); // GitHost and GitHostDirectory
const login = createGitHubLogin(options, connection); // GitHostLogin
```

- Every failure is a `GitHostError` with a `kind`: `not_found` (which also covers forbidden, and a repository the app is not installed on), `rate_limited` (with `retryAfterSeconds`), `transient`, `invalid`, or `unauthorized`, which only a person's own credential produces: the host no longer accepts it, and its holder has to sign in again.
- A sign-in always asks GitHub for its account picker (`prompt=select_account`): GitHub shows which account the person continues with, and the way to another, where it would otherwise send them straight back as whoever its own session has ([ADR-0042](../../docs/adr/0042-every-sign-in-passes-the-git-hosts-account-picker.md)).
- The installation of a repository and its token are kept in memory, the token until shortly before it ends and a missing installation for a minute; requests that need the same token share one mint. A person's token is never kept, and nothing asked with one is cached.
- Repository facts and moving refs are revalidated with `If-None-Match`; a `304` does not count against the rate limit. The cache is in memory, bounded, and an optimization only.
- Redirects are followed only within the configured origin, so credentials never leave it. Reply bodies are read up to a cap, whatever `content-length` claims.
- `readArchive` is the optional bulk transport of the port: one request for the files of a commit. It streams the archive, keeps only the entries the caller asks for, counts bytes after decompression so that a small download cannot unpack into an unbounded one, and never writes to disk. The API redirects the download to another origin; only the origins in `downloadOrigins` are followed (by default the download host of github.com, and none for other installations), and they never receive the credential. Callers verify every body against the hash in the tree.
- Transient failures are retried with jittered backoff. Rate limits are not retried here: the caller decides what to do with `retryAfterSeconds`.

## Fixtures

`fixtures/api.json` holds replies recorded from the public API without credentials and trimmed to what the adapter reads. Tests replay them through an injected `fetch`; nothing in the test suite touches the network. When you record new ones, keep them small and scrub them: no tokens, no private repositories, no personal accounts.

## Rules

For whoever changes this package: read the root [`AGENTS.md`](../../AGENTS.md) first. This package holds the most sensitive credentials in the system.

- **The only GitHub client.** No other workspace imports a GitHub SDK or calls the GitHub API. This package speaks the port from `@skillcdn/core` and returns core types, never SDK types.
- **Token discipline.** Indexing and every read of content use the installation token. A user token is used only to ask what that user can see: who they are, whether a name is a repository to them, and where the app is installed for them. Nothing asked with a user token is cached, and no content is ever read with one. Tokens arrive as arguments or through a provider passed in by the caller; a user token is never module state, and no token is ever logged, part of an error message or part of a returned value other than the credentials `exchangeCode` and `refresh` exist to return.
- **Errors are translated.** Map GitHub responses to the port's error kinds (not found or forbidden, rate limited, transient, invalid). Not found and forbidden must be indistinguishable to callers that face users.
- **Be cheap.** Send conditional requests, prefer tree and blob endpoints over per-file calls, honor `retry-after` and secondary rate limits, and back off with jitter.
- **The app's key signs and stays.** The private key is used to sign the app's own short-lived token and for nothing else; installation tokens are minted with read-only contents and metadata, whatever the installation would allow.
- **Webhooks:** verify the HMAC signature over the raw body with a constant-time comparison before parsing anything. A delivery is read into what it ends (`GitHostEvent`), never into facts: nothing a payload says about a commit, a name or a visibility is passed on as true.
- **Only the repository's own.** The host answers for more under a repository's name than the repository holds: any commit of its fork network, and the head of every pull request made to it. A ref name is asked for as a branch and then as a tag (`commits/heads/..`, `commits/tags/..`), never bare, since a bare name is looked up the way git would, pull request heads included. A commit hash is confirmed by comparing it with the default branch before anything is read by it (ADR-0039).
- **Base URL is operator configuration**, passed in by the caller. It is never derived from user input.
- **This package never reads the environment.**
- **Tests** run against recorded fixtures. Scrub fixtures before committing: no tokens, no private repository data, no real user identifiers. CI makes no live calls.
