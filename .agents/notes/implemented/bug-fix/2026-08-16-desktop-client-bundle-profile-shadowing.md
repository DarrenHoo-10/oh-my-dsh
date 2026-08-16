# Agent Note: Desktop client bundles resolve installation-first

Status: implemented

English | [中文](2026-08-16-desktop-client-bundle-profile-shadowing.zh.md)

## Problem

`ClientModuleRegistry` resolved every `dsh.client` row package from the profile-directory anchor first (`createRequire(ctx.baseUrl)`). On a machine where `$DSH_HOME/profiles/node_modules` had been healed by a different dsh installation (an older checkout or a moved worktree), those junctions made the packaged desktop app compose its client graph — the workspace selector, the model-configuration UI, and every other browser bundle — from the foreign installation's packages. The packaged host skips `healProfilesModuleFallback` because `composeProfile` passes `bareModuleBaseUrl`, so the stale junctions are never reconciled; the served bundles then mismatch the app's own frontend, and the affected UI fails to load. The `app.asar` fallback anchor engaged only after the profile anchor missed, which the foreign junctions prevented.

## Decision

`resolvePkgJson` resolves the modules package's own anchor (`createRequire(import.meta.url)`, inside the same `app.asar` when packaged) first, and the profile anchor second for what the installation misses — out-of-tree plugins declared in the profile's own `node_modules`. This aligns the client rows with the bundle contract that the [profile-plugin-bundles decision](2026-08-05-profile-plugin-bundles.md) already owns: an in-box package always comes from the same installation as the running `dsh`, never from a profile-local copy.

## Alternatives considered

**Profile-manifest allowlist.** Resolve the profile anchor only for names the profile's `package.json` declares. That needs profile-manifest parsing for the same protection; the plain order swap already consults the profile anchor for everything the installation cannot resolve.

**Heal the fallback in packaged mode.** The packaged host skips healing because CommonJS resolution cannot traverse junctions into `app.asar`; re-pointing the junctions there would not make them resolvable.

## Consequences

Development and Web surfaces resolve unchanged: their launches heal the fallback to the running repository, and the installation anchor reaches the same packages. The packaged desktop app ignores stale junctions and serves its own payload. A machine already shadowed needs only the stale fallback deleted — its next dev-mode launch re-heals it, and the packaged app resolves from `app.asar` without it. The regression test pins the order: a profile-local decoy of an in-box package is dropped instead of composed.
