---
"@skillcdn/cli": patch
"@skillcdn/web": patch
---

`skillcdn use` says whether the `.skillcdn.json` it wrote is committed, before anything commits it: it is, so that every clone reads the same pack, unless the repository is public and the file names a deployment of your own or a private pack, which the organization keeps to itself; such a file goes in `.gitignore`, and each clone runs `skillcdn use` once. The command's help, its README and the guide on using skills say the same.
