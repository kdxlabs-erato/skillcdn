// Public surface of @skillcdn/cli as a library (ADR-0110): the reads of a pack as the command
// prints them, for a program with commands of its own that reads packs at a deployment. The
// command itself is `bin.js`; nothing here reads the process or the file system.

export type {
  BrowseQuery,
  CodePage,
  DataQuery,
  FileQuery,
  FindQuery,
  Pack,
  RowsPage,
} from "./pack.js";
export { PackError } from "./pack.js";
export {
  COMMAND_WORDS,
  FILE_PAGE_CHARS,
  OUTPUT_CHARS,
  type PackRead,
  ReadMisuse,
  type ReadOptions,
  type ReadOutput,
  readNumber,
  readPack,
  shellWord,
  wroteLine,
} from "./read.js";
export { DEFAULT_WAIT_MS, openDeployment, type RemoteOptions } from "./remote.js";
