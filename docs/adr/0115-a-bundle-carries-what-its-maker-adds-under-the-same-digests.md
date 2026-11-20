# ADR-0115: A bundle carries what its maker adds, under the same digests

- Status: Accepted
- Date: 2026-11-20
- Amends point 4 of [ADR-0087](0087-the-image-of-a-release-is-published-and-an-installation-is-made-from-a-bundle.md) (nothing of an installation's own goes into a bundle); builds on [ADR-0071](0071-a-deployment-serves-packs-from-a-directory-of-its-own.md) (packs from a directory).

## Context

A bundle held the product and nothing else: the images, the files of `deploy/`, the models. That is enough for whoever installs the product as it is. Whoever makes installations for others carries more with it: the packs the installation is for, a service of their own beside the server, the pages and the manual that go with it. With no place for these in the bundle, such a maker writes a compose file of their own that repeats the product's, a script that loads the images and writes the settings again, and a list of digests of their own, and every release of the product then has to be followed by hand in each copy.

## Decision

1. **`bundle.sh` takes what its maker adds**, each as many times as there are: `--packs DIR`, the packs of a directory without their `.git`; `--add-image REF`, another image in the same archive; `--overlay FILE`, a compose file named `compose.<name>.yaml` beside the bundle's own; `--add PATH`, a file or a directory beside the bundle's files. `VERSION` names the overlays and says that packs came along, and `SHA256SUMS` covers every file, added or not.
2. **`install.sh` lays the maker's overlays over the bundle's own, last**, and keeps them on at every run, as it keeps the product's overlays. `--with` turns on one that stands beside the script without a bundle having named it. An overlay is named by its file, beside the script: no path.
3. **The packs a bundle carries are served from the bundle**, where the installation names no directory, or put into the directory it serves, each where no pack of its name is yet. A pack that is there is the installation's: the script never replaces one, and says how to take the bundle's.
4. **A bundle still carries no settings and no secret.** A file named `.env` among what is added, in a pack or beside it, is refused before anything is written.
5. **Nothing else is added to the product for it.** A maker's service, its image and its pages are the maker's own, built and kept outside this repository; the product gives them a place in the bundle and in the installation.

## Consequences

- **A maker's bundle is the product's bundle and an overlay**, so a release of the product reaches it by making the bundle again.
- **An installation checks what was added as it checks the product**: one list of digests, one script.
- **The compose project is one**: `docker compose ps`, `logs` and `down` in the directory mean the product and what was added.
- **A pack carried once is not updated by a later bundle** while the installation keeps its copy. That is the price of never replacing what is on the host.
- **Tried on one host**: a bundle made with a pack, a second image, an overlay that runs it and its files; installed with `--offline`; the pack served, the added service up, the overlay kept at a second run, the pack put into a directory named later and kept at the run after, and a changed file refused.
- **Rejected:**
  - a second script for makers: it is the fork this record ends;
  - packs served only from a directory the installation names: the first installation would need a step that the bundle can take;
  - replacing a pack on the host with the bundle's: the script would delete what an installation may have changed.
