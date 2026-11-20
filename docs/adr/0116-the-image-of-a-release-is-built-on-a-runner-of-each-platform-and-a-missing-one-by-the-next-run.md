# ADR-0116: The image of a release is built on a runner of each platform, and a release without its image is given it by the next run

- Status: Accepted
- Date: 2026-11-20
- Amends point 1 of [ADR-0087](0087-the-image-of-a-release-is-published-and-an-installation-is-made-from-a-bundle.md) (how and when the release workflow builds the image); what is published, where and under which names stays as decided there.

## Context

The release workflow built the image of a release in one job, for `linux/amd64` and `linux/arm64` at once, the second under emulation, and only in the run that published the packages. Two things followed from that shape.

A build under emulation is the one part of a release that runs on something other than what it is for. In the run of 0.5.3 that build stopped answering after the packages were published, and the job ran into its limit of ninety minutes; the same commit built for `linux/arm64` in under three minutes under another emulator. Nothing in the repository had changed in how the image is built.

And the job had one chance. The workflow reads from the pending changesets and from the registry of the packages what a push is for; once the packages are published, a later push is for nothing, and the image job did not run again. Only running the failed job again by hand could give the release its image, and nothing in the repository said that one was missing. Meanwhile `install.sh` of that release names an image that is not there.

## Decision

1. **Each platform is built on a hosted runner of that platform**: `linux/amd64` on `ubuntu-24.04`, `linux/arm64` on `ubuntu-24.04-arm`. The release workflow emulates nothing. Each build is pushed to the registry by its digest, without a name, with its provenance and its list of contents.
2. **The release is named once, by a job of its own**, from the two digests: `<version>` and `latest` name both platforms together. A tag never means an image of one platform, and a build that failed leaves no name behind.
3. **Every run of the workflow asks which image is missing**, after the publish where there was one. It reads the version the packages share at the pushed commit, takes the tag the publish job makes for that version as the proof that the packages are published and as the commit they were published from, and asks the registry for the image. Without the tag there is no release and nothing is built.
4. **A missing image is built from the commit of the release**, not from the commit pushed: the checkout, the Dockerfile and the revision the image carries are the release's. So a release whose image job failed is finished by the next push to `main`, whatever that push is.
5. **A version the registry has is never built again**, as before, and the question is asked strictly: only the registry answering that it has no such image starts a build. Any other answer, or none, fails the job.
6. **A build may take thirty minutes**, where the one job had ninety: a build that takes a few minutes and has not ended in thirty is not going to.
7. **A fork publishes no image.** The jobs do not run there.

## Consequences

- **A release is whole or says it is not.** After a failed image job the next run of the workflow builds the image, and until then that run's first image job shows which release lacks one.
- **Every push to `main` runs one short job more**, which signs in to the registry and asks one question.
- **The provenance of an image built by a later run** names that run, and the source it names is the commit of the release.
- **The workflow needs a hosted runner of each platform.** A copy of this repository where there is none builds one platform, or builds the other under emulation with a job of its own.
- **Whoever builds the image themselves is not touched**: `deploy/Dockerfile` is the same, and `docker buildx build --platform` builds it for any platform, under emulation where the builder is of another.

## Alternatives considered

- **The same job with a shorter limit.** It fails sooner and as often, and still has one chance.
- **Building once on the workflow's platform and only assembling per platform.** The production tree holds packages with a binary per platform, so the assembly would have to be told the target's platform apart from the builder's, in the Dockerfile every self-hoster also builds: more to keep for the same image.
- **Running the failed job again by hand.** It works, needs someone signed in at the git host, and leaves the release without its image until someone notices.
