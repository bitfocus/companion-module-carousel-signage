import { rm } from 'node:fs/promises'

// Resolve relative to this script so cleanup never targets another working directory.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true })
